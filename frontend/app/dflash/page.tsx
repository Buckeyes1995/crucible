import { redirect } from "next/navigation";
export default function DFlashRedirect() {
  redirect("/benchmark?tab=dflash");
}
