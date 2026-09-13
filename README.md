# Apollo-Smartsuite
Musings on connecting systems
Serial-Number Device Matching: Proxy Design and API Enhancement Proposal
Prepared by: Donny, AVA Designs For: Spacera / Apollo partner engineering Date: September 13, 2026
1. Background
AVA Designs uses the Apollo partner API inside a SmartSuite automation ("Refresh from Apollo," in the Technician Tool solution) to keep room and device data current on our Room BOMs records. Each Room BOM record already carries a Serial Number and an Apollo Workspace ID; the goal is to look up that serial number in Apollo and write back deviceId, lastSeenAt, and related device fields onto the matching record.
The room-level fields on this automation (status, severity, openTicketCount, deviceCount, etc.) all map cleanly because GET /customers/{customerId}/workspaces/{workspaceId} returns them as flat scalars directly on data. Device-level data does not have an equivalent: GET /customers/{customerId}/devices?workspaceId=... returns a PartnerDevice[] array, and the array has no serial-number filter — only search (device name substring), status, and platform. SmartSuite's automation actions can bind a field to a fixed JSON path, but they cannot express "find the array entry where serialNumber equals this record's value" — there is no conditional lookup or scripting step available in our SmartSuite plan's automation actions. As a result, device-level fields can't be mapped natively the way the room-level fields are.
2. Interim solution: a small matching proxy
Until (or unless) Apollo can support this natively, we're standing up a lightweight Node.js proxy between SmartSuite and Apollo:
- SmartSuite's webhook action calls the proxy with customerId, workspaceId, and serialNumber (all already merge fields on the Room BOM record).
- The proxy calls GET /customers/{customerId}/devices?workspaceId={workspaceId} with our partner key (kept server-side, never exposed to SmartSuite), filters the returned array for the matching serialNumber, and returns a single flat object: { "data": { "matched": true, "deviceId": "...", "lastSeenAt": "...", "status": "...", ... } }.
JSON
- SmartSuite maps that flat response the same way it already maps the room-level fields
today — no indexing, no array handling, no cap on device count per room.
This is a stopgap, not a replacement for a native fix — it adds infrastructure we have to run,
monitor, and keep credentials for, and it duplicates matching logic Apollo already has the data to
do server-side, faster and more reliably.
3. Proposed API enhancement
We'd like to ask the Apollo engineering team to evaluate adding a serial-number lookup,
mirroring the pattern already used for workspaces/lookup:
New endpoint: GET /customers/{customerId}/devices/lookup
Parameter Required Description
serialNumber yes Exact serial number to match
workspaceId no Narrows the search to one
room; omit to search the
whole customer
Response shape, consistent with the existing workspaces/lookup envelope:
{
"data": {
"query": { "serialNumber": "SN-12345", "workspaceId": "ws_..." },
"matchCount": 1,
"ambiguous": false,
"match": {
"deviceId": "dev_...",
"workspaceId": "ws_...",
"serialNumber": "SN-12345",
"status": "online",
"manufacturer": "...",
"model": "...",
"firmwareVersion": "...",
"ipAddress": "...",
"lastSeenAt": "2026-09-13T12:00:00Z"
},
"matches": []
}
}
An alternative, smaller-footprint change that would also solve this: add serialNumber as a
filter parameter directly on the existing GET /customers/{customerId}/devices endpoint
(alongside status, platform, search), returning a single-element array when it matches exactly. That's a narrower change to review and ship, though the matchCount/ambiguous shape of a dedicated lookup endpoint is more explicit about handling duplicate serials, which we understand can occur with re-provisioned hardware.
Either change lets SmartSuite (and presumably other partners hitting the same array-mapping limitation) bind device fields the same reliable way the workspace-lookup endpoint already supports for room name matching — no proxy required.
4. Action plan
1. Share this document with Apollo/Spacera partner engineering and request initial feasibility feedback on either option in Section 3.
2. Ask specifically whether serial numbers are guaranteed unique per customer, or whether ambiguous/matches[] handling (as in workspaces/lookup) is needed for re-provisioned or duplicate hardware.
3. If feasible, request a rough timeline and whether it would ship as a versioned addition (no breaking change to GET /devices) or a new endpoint.
4. In the meantime, deploy the Node proxy (scaffold attached) so the SmartSuite automation is unblocked without waiting on the API change.
5. Once/if Apollo ships the native lookup, retire the proxy: repoint the SmartSuite webhook action directly at the new endpoint and remove the proxy's credentials and deployment.
