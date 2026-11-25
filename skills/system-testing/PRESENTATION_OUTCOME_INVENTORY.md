# Actual presentation outcomes

Inventory before edits: `checkPresentation` is consumed by the conventional
renderer runner (`runner.ts` runManagedPresentation) and its exact function
contract tests (`presentation-semantic-projection.test.ts`), plus two open goal
fixtures: local presentation verification, and audience response's visual
admission before writing native panel state. The strict function tests exercise
an explicitly supplied PresentationWorld, including literal headings/data and
renderer interaction probes; they retain that contract. Open user goals cannot
inherit a reference author's component IDs, default props, chosen format or
fixture-selected interaction as additional requirements.

The existing local `selectedViews` already canonicalizes actual allowed props
through the renderer and rejects changed/injected MDX, duplicate IDs, excessive
views and oversized output. Move that projection to the common presentation
module and reuse it at both open consumers and at verification. Native panel
ownership, attempt/build identity, current source revision, CAS/readback, DOM
rendering, saved MDX hashes and protected committed state remain checked.
Read-only DOM control state supplements actual native text without selecting a
fixture-preferred user option. Strict renderer interaction tests are unchanged.

`bindObservedContentReview` is the shared Base producer, with27 domain bindings
and a mirror in Host `scripts/lib/observed-content-admission.mjs`. It correctly
requires review for requested returned values or retained artifact fields. Local
presentation alone classified its displayed report/DOM solely as observations
and its optional native receipt as no requested return, inadvertently disabling
meaning review. Bind actual report and actual display as artifact fields and
make Host registration require review for every local-presentation goal. The
audience binding already requires a domain answer/review; additionally bind its
actual accepted presentation artifact rather than only a returned answer.
Other bindings either provide their native artifact keys or declare domain
returned values; this change does not reinterpret nonpresentation native-effect
contracts. All27 field maps remain byte-bound by the shared Host verifier.

No source facts, user goal text, IDs, splits or permissions change. Meaning review
uses the original goal, native current source, actual rendering/DOM/control state
and actual retained MDX, never expected reference props. Historic evidence may be
reassessed only from its original captured observations; missing native evidence
cannot be manufactured by rerunning a world or a teacher.

Preview admission also tied every presentation view ID to a source section ID.
That is unnecessary for an open goal that legitimately combines or resegments
information. Keep actual IDs unique and renderer-safe; source authority binds
the observed record ID/revision and meaning review binds the content, rather
than requiring a one-section/one-component route.

Focused Host-owned validation:9 fixture/strict-renderer tests plus4 native Host
binding tests pass, including the actual valid booking props, arbitrary native
layout identity, mandatory artifact review, stale DOM/state/owner negatives,
unsafe MDX and invalid props, and audience-response admission. These are
conventional offline tests, not a claim of new live browser/teacher execution.
Catalog metadata changes only16 requiresReview flags (13train/3test); all20
local-presentation goals (15train/5test) now require goal meaning review.
