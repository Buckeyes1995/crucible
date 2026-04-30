import { redirect } from "next/navigation";

// /downloads is the old URL. The Store supersedes it — keep the path working
// so bookmarks and links don't die, but send users to the new landing.
export default function DownloadsRedirect() {
  redirect("/store?tab=downloads");
}
