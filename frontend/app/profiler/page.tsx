import { redirect } from "next/navigation";
export default function ProfilerRedirect() { redirect("/analytics?tab=profiler"); }
