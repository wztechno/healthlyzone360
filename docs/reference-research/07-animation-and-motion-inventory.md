# 07 — Animation and motion inventory

Retrieval date: **2026-07-30**.

## 1. An honest statement of what this document can and cannot say

Motion was the least observable dimension of this research, and this document says so plainly rather
than filling the gap.

In this session the browser pane could not composite frames (doc 01 §5). **No animation was watched.
No screenshot or recording was taken. No transition was timed.** Synthetic pointer events did not
reach either page, so hover, press and open/close transitions were never triggered.

What remains observable is: which surfaces are *structurally* animated (a panel that opens, an
accordion that expands, a carousel that scrolls), and what the static layout implies about the kind
of motion involved. That is recorded below as `INFERRED`, clearly marked. **No duration, no easing
curve, no delay and no choreography is claimed for either product**, because none was measured.

This matters less than it might appear. Our specification forbids reproducing any competitor
animation, so the useful output of this document is not a set of values to copy — it is a set of
*moments that need motion*, which is fully derivable from structure.

## 2. Surfaces that are structurally animated

### 2.1 Right Bite

| # | Surface | Motion implied | Classification | Source |
| --- | --- | --- | --- | --- |
| RBM-01 | Navigation menu panel | An overlay panel with its own close control opens over the page below the desktop breakpoint | `INFERRED` from the panel's structure and its close affordance | RB-04 |
| RBM-02 | FAQ accordion | Expand and collapse of answer regions already present in the document | `INFERRED` from structure | RB-04 |
| RBM-03 | Package-type row | At 390 px and 768 px the five cards lay out along a single horizontal line extending well beyond the viewport, inside a container that does not overflow the page — a horizontally scrolling strip | `OBSERVED_PUBLIC` (layout measurement) | RB-04 |
| RBM-04 | Selection feedback on configurator chips and cards | A selected state must be rendered for a single-select group to be usable | `INFERRED` | RB-04 |
| RBM-05 | Subtotal update | A figure derived from three selections changes when a selection changes | `INFERRED`; see `RB-INF-03` | RB-04 |
| RBM-06 | Statistic counters | Four large numerals presented as a group — a common but unverified count-up candidate | `UNKNOWN` | RB-04 |
| RBM-07 | Landing page media | A media asset named as an animated image appears among the plan detail imagery | `OBSERVED_PUBLIC` (asset name in the accessible tree) — **not downloaded, not viewed** | RB-04 |
| RBM-08 | Page transitions between routes | `UNKNOWN` | — | — |
| RBM-09 | Any duration, easing or choreography | `UNKNOWN` | — | — |

### 2.2 Eat This Much

| # | Surface | Motion implied | Classification | Source |
| --- | --- | --- | --- | --- |
| ETM-M01 | Diets dropdown | A parent navigation item revealing six children | `INFERRED` from structure | ETM-02 |
| ETM-M02 | Menu panel below the desktop breakpoint | A menu button is present and displayed at 390 px and 768 px | `OBSERVED_PUBLIC` (presence) / `INFERRED` (transition) | ETM-02 |
| ETM-M03 | Field-level help disclosure | Help controls on two calculator fields reveal additional content | `INFERRED` | ETM-03 |
| ETM-M04 | Explanatory panels | Six expandable panels beside the calculator form | `INFERRED` | ETM-03 |
| ETM-M05 | Calculator result appearance | The transition from an empty form to a rendered result | `UNKNOWN` — never rendered | ETM-03 |
| ETM-M06 | Generated-plan appearance | The transition from the landing form to a generated plan | `UNKNOWN` — never rendered | ETM-02 |
| ETM-M07 | Planner regeneration | The vendor documents that a meal is replaced in place while its neighbours are undisturbed — an item-level replacement, not a page reload | `DOCUMENTED_PUBLIC` (the behaviour) / `UNKNOWN` (its motion) | ETM-09 |
| ETM-M08 | Nutrition progress indicator | The vendor documents a progress bar that expands to reveal detail | `DOCUMENTED_PUBLIC` (the component) / `UNKNOWN` (its motion) | ETM-13 |
| ETM-M09 | Drag-and-drop from the food bank | The vendor documents dragging foods into meal slots — inherently a continuous, pointer-driven motion | `DOCUMENTED_PUBLIC` (the interaction) / `UNKNOWN` (its motion) | ETM-09 |
| ETM-M10 | Any duration, easing or choreography | `UNKNOWN` | — | — |

## 3. The moments that need motion — derived, not copied

This is the transferable output. Each row is a moment in *our* product where a state change would be
confusing without motion. Each is justified by a structural observation, never by a copied
implementation.

| # | Moment in our product | Why motion is needed | Derived from |
| --- | --- | --- | --- |
| MOT-01 | Overlay panel open and close (navigation drawer, replacement drawer, action sheet) | An overlay that appears instantly gives no sense of where it came from or how to dismiss it | RBM-01, ETM-M02 |
| MOT-02 | Accordion and disclosure expansion | Height change without motion causes the content below to jump, losing the reader's place | RBM-02, ETM-M03, ETM-M04 |
| MOT-03 | Single-select state change in a chip or card group | Selection is the primary feedback in a configurator; it must be immediate and unmistakable | RBM-04 |
| MOT-04 | A derived figure changing — subtotal, calorie total, macro total | A silently changing number is easy to miss and undermines trust in the calculation | RBM-05 |
| MOT-05 | Replacing one planner entry while its neighbours stay put | Without motion the user cannot tell whether one meal changed or the whole plan did | ETM-M07 |
| MOT-06 | Progress toward a nutrition target | A meter that jumps conveys less than one that travels, and travel makes the direction of change legible | ETM-M08 |
| MOT-07 | Loading and generation | Generation takes real time; skeletons are needed so the layout does not reflow when content lands | ETM-M05, ETM-M06 |
| MOT-08 | Horizontally scrollable option strips on narrow viewports | A strip that extends past the fold must signal that it scrolls, or its later options are never discovered | RBM-03 |
| MOT-09 | Route transition between shells | Moving between marketplace and customer areas benefits from a transition that signals a context change | RBM-08 |
| MOT-10 | Adding an item to a cart or plan | Confirmation feedback for an action whose result is not visible on the current screen | ETM-M09 |

## 4. Constraints our motion system must honour, which this research reinforces

| # | Constraint | Justification |
| --- | --- | --- |
| CST-01 | **No competitor animation is reproduced.** | Specification requirement. This document contains no duration, easing curve or choreography from either product, so there is nothing available to copy even accidentally |
| CST-02 | Reduced-motion preference must collapse every animation to a zero-duration state change | Accessibility requirement; independent of the references |
| CST-03 | No mouse-following or hover-dependent effect on touch devices | Specification requirement. Both references present hover-capable desktop layouts and touch-oriented narrow layouts; a hover-only affordance would be unreachable in the latter |
| CST-04 | Motion direction must derive from the resolved text direction, not from a hard-coded axis | Right Bite ships an Arabic locale; our product ships Arabic. A drawer that always enters from the same physical edge is wrong in one of the two directions |
| CST-05 | Staggered entry must be capped | A weekly planner can hold dozens of entries; an uncapped stagger turns a list into a wait |
| CST-06 | Horizontal scroll must never reach the page body | Right Bite's narrow layout keeps its overflowing option strip inside a container while the document itself does not scroll horizontally (doc 08). This is the correct containment and our responsive tests already assert it |
| CST-07 | Visual-regression baselines must be captured with animation disabled | Otherwise a baseline captures a frame mid-transition and the comparison is non-deterministic |

## 5. What a permissioned or better-instrumented session could add

| # | Item | Would require |
| --- | --- | --- |
| GAP-01 | Any timing, easing or choreography on either product | A session where the browser pane composites frames |
| GAP-02 | Planner regeneration motion, lock feedback, drag behaviour | An authenticated Eat This Much session — `REQUIRES_PERMISSION` |
| GAP-03 | Right Bite post-checkout and in-application motion | A permissioned session in the mobile application — `REQUIRES_PERMISSION`; itemised in doc 15 |
| GAP-04 | Whether either product honours a reduced-motion preference | A session able to set the preference and observe the difference |

**None of these gaps blocks our implementation.** Our motion system is required to be original, so
the absence of measured competitor timings is not a deficiency — the moment list in §3 is what
implementation needs, and it is complete.
