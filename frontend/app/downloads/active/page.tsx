import { redirect } from "next/navigation";
export default function DownloadsActiveRedirect() {
  redirect("/store?tab=downloads");
}
