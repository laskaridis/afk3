# Feature Specification: <feature name>

## Purpose / Big Picture

Explain in plain, non-technical language, what problem needs to be solved. Why this feature is valuable, what problem does it solve, who benefits after this change and in what way. State the user-visible behavior enabled by the feature.

## User stories

Follow a vertical instead of horizontal split of delivered value when drafting stories. Each story should have the following key characteristics:

1. **Independent**: Prefer stories that can be implemented, tested, and released without requiring unrelated stories or coordinated changes. Avoid hidden dependencies, shared refactors, or coupling across multiple features.
2. **Vertical**: Draft stories that deliver observable user-facing or system-visible behavior end-to-end. Avoid stories that cut through horizontal layers of infrastructure, plumbing, or layered-only work unless explicitly required.
3. **Small**: Prefer stories with tightly bounded scope that can be implemented with minimal context and low risk of drift. Avoid broad refactors, multi-feature work, or cross-cutting architectural changes.
4. **Testable**: Define explicit pass/fail acceptance criteria with observable outcomes and deterministic verification steps. Avoid vague quality statements, subjective expectations, or unverifiable behavior.

Examples:

- GOOD - vertical story: 
  As a shopper, I want to save a product to my wishlist, so that I can easily find and buy it later.
- BAD? - dependent:
  As a shopper, I want to share a wishlist by email.
- GOOD - independent:
  As a shopper, I want to remove a product from my wishlist, so that I can keep only the products I am still interested in.
- BAD - horizontal story:
  As a developer, I want to create a database table for wishlists, so that wishlist data can be stored.
- GOOD - small story:
  As a shopper, I want to see whether a product is already in my wishlist, so that I do not add the same product twice.
- GOOD - testable story: 
  As a shopper, I want to add an available product to my wishlist, so that the product appears in my wishlist after I add it.
- BAD - non testable:
  As a shopper, I want the wishlist to feel intuitive, so that I have a better experience.
- BAD - big story:
  As a shopper, I want a complete wishlist system with adding, removing, sharing, price alerts, stock alerts, recommendations, and checkout integration, so that I can manage all products I may want to buy.

### US-001: <title in 1 sentence>

Describe the story in concise, plain language. Use either of the following story formats which fits best to the particular situation.

1. When you need to focus on who benefits: As a <user>, I want to <capability>, so that <value>

Example: As a returning customer, I want to save my payment details, so that I can check out faster on future purchases.

2. When you need to focus on the specific context or trigger and less on the user: When <situation/trigger>, I want to <capability>, so that <value>.

Example: When my internet connection drops, I want to see a clear offline troubleshooting guide, so that I can fix the issue without contacting support.

3. When writing stories for technical features: For <system/component>, we need to <capability>, so that <value>.

Example: For the database server, we need to upgrade to version 15.2, so that we can ensure security compliance and reduce query load times.

#### Acceptance criteria 

Good acceptance criteria are: specific, unambiguous, verifiable, and outcome-oriented. Avoid acceptance criteria that are vague, subjective, overly broad, prescribe implementation details without a strong reason, or use vague language like “intuitive,” “modern,” “robust,” or “seamless” without clear measurable criteria. 

**ASK:** Could two implementers satisfy this criterion while producing materially different behavior? If so, evaluate if that difference derives from an unresolved decision or gap in requirements.

Use Gherkin/BDD for acceptance criteria. Use a concise checklist or table when a scenario format would obscure the acceptance condition.

- **AC-001:** Given <initial condition(s)>, When <action>, Then <expected outcome>. Example: "Given the user has items in their cart, When they click "Checkout", Then they are redirected to the billing page."
- etc.

Make sure that acceptance criteria codes are monotonically increasing and unique across use cases. Example: If use csase `UC-001` includes `AC-001` then acceptance criteria for use case `UC-002` start with `AC-002`.

## Assumptions

- Identify here any assumptions that underly the agreed scope.

## Out of Scope

- Identify here anything that falls outside the scope for this feature.

## Clarifications needed

Mention anything in the spec that is ambiguous, contradictory or requires further clarification to make it more concrete.

- Avoid listing entries here for which reasonable, low-impact defaults exist that do not meterially affect scope, user-visible behaviour, architecture or acceptance criteria. Instead, directly update the spec accordingly and record any inferred decision under assumptions.
- Avoid being pedantic or nitpicky. Call out only anything that materially impacts the feature, observable behaviour, architecture or acceptance criteria.
- If any open question can be answered from inspecting the codebase do not add it here. Instead, inspect the codebase and then update the spec accordingly.
