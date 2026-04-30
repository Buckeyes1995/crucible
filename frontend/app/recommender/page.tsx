import { redirect } from "next/navigation";
export default function RecommenderRedirect() {
  redirect("/store?tab=recommender");
}
