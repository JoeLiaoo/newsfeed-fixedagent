import { redirect } from "react-router";

/**
 * The task history now lives in 「我的任务与产物」: the old address stays usable and lands there,
 * carrying only the paging parameters over.
 */
export function loader({ request }: { request: Request }) {
  throw redirect(`/account/artifacts${new URL(request.url).search}`);
}
