# Vine AI — Product & System Specification (MVP)

## 1. Product Overview

### 1.1 Goal

Vine AI is a structured, adaptive learning system designed to build foundational math fluency and confidence through targeted practice, adaptive difficulty, and repetition until mastery.

The system prioritizes:

- Mastery over exposure
- Understanding over guessing
- Confidence through consistent success

### 1.2 Core Principles

- **Start at the Right Level** — Use diagnostics to avoid frustration or boredom
- **Repetition Drives Mastery** — Mistakes are revisited through similar problems; reinforcement targets weak areas
- **Structured Difficulty** — Problems are generated intentionally, not randomly; difficulty is measurable and controllable
- **Progress is Visible** — Users can track improvement over time; weak areas are clearly surfaced
- **Short, Focused Sessions** — Designed for 5–10 minute engagement to minimize fatigue and maximize consistency
- **Data-Driven Foundation** — All interactions are captured for future modeling; system is designed to evolve toward Elo / IRT-based adaptation

---

## 2. Scope (MVP)

### 2.1 Included

- Addition and subtraction
- 1–3 digit numbers
- Carry and borrow mechanics
- Diagnostic assessment (~15 minutes)
- Adaptive practice sessions (5 min, 10 min)
- Progress tracking (problem history, mistake classification)

### 2.2 Explicitly Excluded (MVP)

- Multiplication and division
- Fractions, exponents, algebra (future phases)
- Word problems
- Gamification systems (streaks, rewards)
- Multi-user / classroom features

### 2.3 Future Expansion Path

1. Multiplication / Division
2. Fractions
3. Expressions / Order of Operations
4. Intro Algebra (solve for x)

---

## 3. Core Concepts

### 3.1 Problem Model

Each problem is represented as structured data:

```json
{
  "id": "uuid",
  "operation": "addition | subtraction",
  "operands": [47, 38],
  "answer": 85,
  "properties": {
    "num_digits": 2,
    "num_carries": 1,
    "num_borrows": 0
  },
  "skill_tag": "2_digit_addition_with_carry",
  "difficulty_score": 0.45
}
```

### 3.2 Skill System

Problems are grouped into skills representing specific concepts. Each skill represents a distinct learning objective and has an associated mastery level per user.

Example skills:

- `1_digit_addition`
- `2_digit_addition_no_carry`
- `2_digit_addition_with_carry`
- `2_digit_subtraction_no_borrow`
- `2_digit_subtraction_with_borrow`
- `3_digit_mixed`

### 3.3 Difficulty Model

Difficulty is computed heuristically based on problem structure.

**Components:** operation type, number of digits, number of carries (addition), number of borrows (subtraction)

**Example formula:**

```
difficulty_score =
  base(operation)
  + digit_weight * num_digits
  + carry_weight * num_carries
  + borrow_weight * num_borrows
```

> Scores are normalized (e.g., 0–1) and used for ordering and selection, not absolute measurement.

### 3.4 User Model

```json
{
  "skill_mastery": {
    "2_digit_addition_with_carry": 0.7
  },
  "current_skill": "2_digit_addition_with_carry",
  "mistake_profile": {
    "carry_error": 12,
    "borrow_error": 3,
    "arithmetic_fact_error": 5
  }
}
```

### 3.5 Mistake Classification

Each incorrect answer is categorized. Initial categories:

- `carry_error`
- `borrow_error`
- `arithmetic_fact_error`
- `sign_error`

Used to guide repetition and identify conceptual gaps.

---

## 4. Diagnostic System

### 4.1 Purpose

Determine starting skill level and initial mastery estimates.

### 4.2 Algorithm

For each skill tier (in increasing difficulty):

1. Present 3–5 problems
2. Compute accuracy
3. If accuracy ≥ 80% → advance; otherwise → stop

### 4.3 Output

- `current_skill` = last passed skill
- Initial mastery levels
- Initial mistake profile

---

## 5. Practice System (Core Loop)

### 5.1 Session Types

| Type | Duration | Notes |
|------|----------|-------|
| Diagnostic | ~15 minutes | One-time (or infrequent re-evaluation) |
| Practice (short) | 5 minutes | Ends on time or problem count |
| Practice (standard) | 10 minutes | Ends on time or problem count |

### 5.2 Problem Selection Strategy

Each session draws from:

- **60%** — Current skill
- **20%** — Past mistakes (review)
- **20%** — Slightly harder skill (exploration)

### 5.3 Response Handling

**If correct:**
- Increase mastery score
- Reduce frequency of similar problems

**If incorrect:**
- Log attempt
- Classify mistake
- Enqueue similar problem for repetition

### 5.4 Mastery Update (Simple Model)

```
if correct:   mastery += small_increment
else:         mastery -= penalty
```

Values clamped between 0 and 1.

### 5.5 Skill Progression

Advance when:

- Mastery ≥ threshold (e.g., 0.85)
- Sufficient attempts completed

---

## 6. Problem Generation

### 6.1 Approach

Template-based generation. Example: *"2-digit addition with exactly 1 carry"*

**Steps:**
1. Generate operands
2. Validate constraints
3. Compute answer
4. Assign properties and difficulty

### 6.2 Constraints

- Avoid excessive repetition
- Avoid trivial or degenerate cases unless intentional

---

## 7. Data Collection & Storage

### 7.1 Principles

- All attempts are stored
- No critical learning data is discarded
- Data is structured for future modeling (Elo / IRT)

### 7.2 Attempt Record

```json
{
  "problem_id": "...",
  "user_answer": 84,
  "correct_answer": 85,
  "is_correct": false,
  "time_taken_ms": 4200,
  "timestamp": "...",
  "skill_tag": "...",
  "mistake_type": "carry_error",
  "session_id": "..."
}
```

### 7.3 Use Cases

- Mastery calculation
- Progress tracking
- Mistake analysis
- Future adaptive modeling

---

## 8. Progress Tracking

### 8.1 Metrics

- Accuracy per skill
- Mastery per skill
- Recent performance trends

### 8.2 UI (Conceptual)

- Skill list with mastery indicators
- Highlight weakest skills
- Show improvement over time

---

## 9. System Architecture (MVP)

### 9.1 Overview

A lightweight web application with persistent backend storage.

### 9.2 Recommended Stack

| Layer | Technology |
|-------|------------|
| Frontend | Hosted on personal site (e.g., Vercel) |
| Backend | Serverless API (Vercel Functions or similar) |
| Database | Hosted Postgres (Supabase or Neon) |

### 9.3 Core Components

- Problem Generator
- Diagnostic Engine
- Adaptive Engine
- User State Manager
- History Store

### 9.4 Rationale

- Minimal infrastructure overhead
- Easy deployment alongside personal site
- Enables full data collection for future modeling

---

## 10. Future Extensions

### 10.1 Learning System

- Multiplication / division
- Fractions
- Algebra

### 10.2 Adaptation Improvements

- Elo-based difficulty adjustment
- IRT-based modeling

### 10.3 Product Features

- Gamification (streaks, rewards)
- Teacher / parent dashboards
- Spaced repetition scheduling

---

## 11. Non-Goals (MVP)

- Perfect difficulty modeling
- Full curriculum coverage
- Advanced UI/UX polish

---

## 12. Success Criteria (MVP)

The MVP is successful if:

- [ ] Users can complete diagnostic + practice sessions
- [ ] Problems adapt to user performance
- [ ] Mistakes are tracked and revisited
- [ ] Progress is measurable and visible
- [ ] Data is reliably stored for future analysis
