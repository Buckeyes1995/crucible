import { redirect } from "next/navigation";
export default function UsageRedirect() { redirect("/analytics?tab=usage"); }
