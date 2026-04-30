import { redirect } from "next/navigation";
export default function ArenaReviewRedirect() {
  redirect("/arena?tab=review");
}
