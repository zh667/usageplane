import { newApiFamilyAdapter } from "./common/newApiFamily.js"
import { registerAdapter } from "./types.js"

// M3 scope: New API + One API share the balance contract (docs/relay-sites.md).
// Other family members (veloera, one-hub, done-hub, …) need per-type
// verification before registering here — do not alias them blindly.
registerAdapter(newApiFamilyAdapter, "one-api")

export { getAdapter, supportedTypes } from "./types.js"
export type { RelayAdapter, RelayBalance, RelayCapability } from "./types.js"
