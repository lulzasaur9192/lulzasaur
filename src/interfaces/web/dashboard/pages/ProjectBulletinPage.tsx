import { useApp } from "../context/AppContext.js";
import { useApi } from "../hooks/useApi.js";
import { fetchBulletin } from "../api.js";
import { BulletinPostItem } from "./BulletinPage.js";

export function ProjectBulletinPage() {
  const { currentProjectFilter } = useApp();

  const { data: posts } = useApi(
    () => fetchBulletin(undefined, currentProjectFilter!),
    [currentProjectFilter]
  );

  if (!currentProjectFilter) {
    return <div className="loading">No project selected.</div>;
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="loading">No bulletin posts for this project yet.</div>
    );
  }

  return (
    <>
      {posts.map((p) => (
        <BulletinPostItem key={p.id} post={p} />
      ))}
    </>
  );
}
