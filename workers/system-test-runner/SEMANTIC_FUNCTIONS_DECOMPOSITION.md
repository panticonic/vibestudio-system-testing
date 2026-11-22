# Application entry capture

Each task binds a public Natlang function and actual arguments from the installed semantic library. The domain function returns its own typed value. Nested functions and installed skill mounts retain their normal hierarchy. The harness records the declared entry, exact result and all captured calls.

| Stage | Representation | Reason |
| --- | --- | --- |
| Interpret the application request | Public natural-language function | Domain judgment belongs to the application codebase. |
| Select a task's declared entry and bind initial arguments | TypeScript registry lookup | The authored task already names the application contract. |
| Execute with scoped services and capture exchanges | TypeScript runtime plumbing | Call identity and recorded model exchanges must stay exact. |
| Verify effects and requested returned values | Independent application verifier | Observable outcomes determine success. |
| Convert an application result for an existing domain verifier | Temporary TypeScript bridge | Existing verifiers receive their historical fixture envelope while models return only typed application values. The bridge has no model call and changes no value. |
| Retain outcome dimensions and trace | TypeScript attestation | The training exporter must distinguish effect evidence, application return checks and execution conventions. |

Required answers stay required. Effects and returned values are declared separately, and a convention can be omitted only when a specific task contract supplies an independent observable proof of every requested outcome. A name resembling a report is insufficient reason to omit it.
