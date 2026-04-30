import { redirect } from "next/navigation";
export default function TokenAnalyticsRedirect() { redirect("/analytics?tab=tokens"); }
