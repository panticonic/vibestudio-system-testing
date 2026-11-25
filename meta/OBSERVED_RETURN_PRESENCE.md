# Observed return presence at the generated verifier boundary

Pre-edit inventory (parent962213b): authored-teacher.ts captureWorkflow is the
single producer of applicationResult/applicationResultKind. It sets them only
after an awaited root returns, tagging actual undefined as void/null; throws
omit both. Its report is a legacy projection initialized to null, and is not an
observed-return witness. openGoalTeacherCode and composed/domain wrappers share
that capture producer. openGoalOutcomeCode156–164 alone emits verification
actualResult/Kind, incorrectly deriving it from the report sentinel. All open
goal managed cases call this wrapper; index.ts1487/1539/1631/1680/2139 directly
verify legacy domain/checklist reports without emitting actual return metadata.
They do not implement this witness protocol and remain unchanged.

Base application-outcomes/observed-invocation.ts consumes actual captured record
outputs only from completed calls with hash-matched retained bytes; it does not
infer an application return from a declared type. Semantic outcome normalization
assesses effect/required-return dimensions independently. Host
openOutcomeGoalEvidence consumes actualResult/Kind and teacher applicationResult
presence as an optional strict witness, distinct from the entry's resultType.
Host entry binding/export recovery is owned separately; this change does not
relax those checks. Model engines and transport do not create these verifier
fields and are outside this generated wrapper repair.

Use Object.hasOwn(teacher,"applicationResult") as the presence source. Pass
undefined to prepared.verify for absent returns and observed completed void;
keep a genuine null value as null. Emit proof actualResult only for an observed
return, and actualResultKind only for observed completed void. Root exceptions
preserve complete captured calls/errors/effects while emitting neither witness.

Actual verification: eight generated capture/wrapper runtime tests PASS
(vibe-observed-return-presence-20261125a, LOW1GiB/reserve7.5,361.6MiB peak).
Root errors with declared void and nonvoid both pass actual undefined to the
verifier and omit both witnesses in raw and JSON-serialized objects while keeping
calls/error/native effect proof. Successful undefined retains void/null; actual
null and object returns retain their values without a void marker. Source syntax
and diff checks PASS. No model calls, whole type graph, live verification rerun
or completed-wave export recovery is claimed by this component check.
