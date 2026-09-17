import { WORKSPACE_EVENT_TIME_HEADER } from "../headers";

/** Calibrate each stream without changing Beignet's SSE protocol. */
export function withWorkspaceEventClock(response: Response): Response {
	if (response.ok)
		response.headers.set(WORKSPACE_EVENT_TIME_HEADER, String(Date.now()));
	return response;
}
