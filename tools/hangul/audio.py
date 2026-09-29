"""Generate and check the Hangul practice audio.

    pip install edge-tts faster-whisper
    python tools/hangul/audio.py generate [--force] [ids...]
    python tools/hangul/audio.py check [ids...]

generate synthesizes static/hangul/audio/<id>.mp3 for every item in
data/hangul.json that doesn't have a clip yet. check transcribes each clip
with Whisper and flags any whose transcript matches neither the spelling
nor the listed pronunciation, as a stand-in for a native listener. Expect
false alarms on one-syllable words: a final consonant is unreleased and
nearly silent (앞 is heard as 아), and without context Whisper often mixes up
plain, aspirated and tense consonants (자다/차다). Treat those flags as a
judgment call; a flag on a longer word is worth replacing the word over.
"""

import argparse
import asyncio
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "hangul.json"
AUDIO = ROOT / "static" / "hangul" / "audio"
# SunHi drew 27 Whisper flags over the full list; InJoon drew 44.
VOICE = "ko-KR-SunHiNeural"


def load_items(ids):
    items = json.loads(DATA.read_text())["items"]
    if ids:
        items = [item for item in items if item["id"] in ids]
    return items


async def generate(items, force):
    import edge_tts

    AUDIO.mkdir(parents=True, exist_ok=True)
    for item in items:
        path = AUDIO / f"{item['id']}.mp3"
        if path.exists() and not force:
            continue
        # A trailing period keeps short words from being clipped.
        text = item["ko"] if re.search(r"[.?!]$", item["ko"]) else item["ko"] + "."
        await edge_tts.Communicate(text, VOICE, rate="-10%").save(str(path))
        print("wrote", path.name, item["ko"])


def hangul_only(text):
    return re.sub(r"[^가-힣]", "", text)


def check(items):
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3-turbo", compute_type="int8")
    flagged = 0
    for item in items:
        path = AUDIO / f"{item['id']}.mp3"
        if not path.exists():
            print(f"MISSING  {item['id']}")
            flagged += 1
            continue
        segments, _ = model.transcribe(str(path), language="ko", beam_size=5)
        heard = "".join(segment.text for segment in segments).strip()
        accepted = {hangul_only(item["ko"]), hangul_only(item.get("pron", ""))}
        if hangul_only(heard) in accepted:
            continue
        flagged += 1
        print(f"FLAG  {item['id']:<22} {item['ko']:<14} heard: {heard}")
    print(f"{flagged} of {len(items)} flagged")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["generate", "check"])
    parser.add_argument("ids", nargs="*")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    items = load_items(set(args.ids))
    if args.command == "generate":
        asyncio.run(generate(items, args.force))
    else:
        check(items)


if __name__ == "__main__":
    main()
