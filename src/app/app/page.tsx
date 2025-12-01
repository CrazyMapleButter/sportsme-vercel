"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const ATTACHMENTS_BUCKET = "attachments";

type Group = {
  id: number;
  name: string;
  code: string;
  owner_id: string;
};

type Post = {
  id: number;
  group_id: number;
  content: string;
  type: string;
  created_at: string;
  author_name: string | null;
};

type Comment = {
  id: number;
  post_id: number;
  content: string;
  created_at: string;
  author_name: string | null;
};

type Attachment = {
  id: number;
  post_id: number;
  url: string;
  original_name: string;
  mime_type: string;
  size: number;
};

type PollOption = {
  id: number;
  post_id: number;
  text: string;
};

type PollVote = {
  id: number;
  post_id: number;
  option_id: number;
  user_id: string;
};

export default function AppPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pollOptions, setPollOptions] = useState<PollOption[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postType, setPostType] = useState<"message" | "poll">("message");
  const [newContent, setNewContent] = useState("");
  const [pollOptionsInput, setPollOptionsInput] = useState<string[]>(["", ""]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load user + groups on mount
  useEffect(() => {
    async function init() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.replace("/login");
        return;
      }

      setUserId(user.id);
      const nameFromMeta = (user.user_metadata as any)?.full_name as string | undefined;
      setDisplayName(nameFromMeta || user.email || "Unknown");

      // Load groups via memberships
      const { data: memberships, error: gmError } = await supabase
        .from("group_memberships")
        .select("group_id, groups ( id, name, code, owner_id )")
        .eq("user_id", user.id);

      if (gmError) {
        console.error(gmError);
        setError("Failed to load groups.");
        setLoading(false);
        return;
      }

      const gs: Group[] = (memberships || [])
        .map((m: any) => m.groups)
        .filter(Boolean);

      setGroups(gs);

      if (gs.length > 0) {
        setSelectedGroupId(gs[0].id);
        await loadFeed(gs[0].id);
      }

      setLoading(false);
    }

    init();
  }, [router]);

  async function loadFeed(groupId: number) {
    setError(null);
    const { data: posts, error: pErr } = await supabase
      .from("posts")
      .select("id, group_id, content, type, created_at, author_name")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (pErr) {
      console.error(pErr);
      setError("Failed to load posts.");
      return;
    }

    setFeed(posts || []);

    const ids = (posts || []).map((p: any) => p.id);
    if (ids.length === 0) {
      setComments([]);
      return;
    }

    const { data: commentRows, error: cErr } = await supabase
      .from("comments")
      .select("id, post_id, content, created_at, author_name")
      .in("post_id", ids);

    if (cErr) {
      console.error(cErr);
      setError("Failed to load comments.");
      return;
    }

    setComments(commentRows || []);

    const { data: attachmentRows, error: aErr } = await supabase
      .from("file_attachments")
      .select("id, post_id, url, original_name, mime_type, size")
      .in("post_id", ids);

    if (aErr) {
      console.error(aErr);
      setError("Failed to load attachments.");
      return;
    }

    setAttachments(attachmentRows || []);

    const { data: optionRows, error: oErr } = await supabase
      .from("poll_options")
      .select("id, post_id, text")
      .in("post_id", ids);

    if (oErr) {
      console.error(oErr);
      setError("Failed to load poll options.");
      return;
    }

    setPollOptions(optionRows || []);

    const { data: voteRows, error: vErr } = await supabase
      .from("poll_votes")
      .select("id, post_id, option_id, user_id")
      .in("post_id", ids);

    if (vErr) {
      console.error(vErr);
      setError("Failed to load poll votes.");
      return;
    }

    setPollVotes(voteRows || []);
  }

  async function handleCreateGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    setError(null);
    setCreatingGroup(true);
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) {
      setError("Group name is required.");
      setCreatingGroup(false);
      return;
    }
    const code = Math.random().toString(36).substring(2, 8);

    const { data: group, error: gErr } = await supabase
      .from("groups")
      .insert({ name, code, owner_id: userId })
      .select("id, name, code, owner_id")
      .single();

    if (gErr || !group) {
      console.error(gErr);
      setError("Failed to create group.");
      setCreatingGroup(false);
      return;
    }

    await supabase.from("group_memberships").insert({
      user_id: userId,
      group_id: group.id,
      role: "owner",
    });

    const newGroups = [group as Group, ...groups];
    setGroups(newGroups);
    setSelectedGroupId(group.id);
    await loadFeed(group.id);
    form.reset();
    setCreatingGroup(false);
  }

  async function handleJoinGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    setError(null);
    setJoiningGroup(true);
    const form = e.currentTarget;
    const code = (form.elements.namedItem("code") as HTMLInputElement).value.trim();
    if (!code) {
      setError("Enter a group code.");
      setJoiningGroup(false);
      return;
    }

    const { data: group, error: gErr } = await supabase
      .from("groups")
      .select("id, name, code")
      .eq("code", code)
      .single();

    if (gErr || !group) {
      console.error(gErr);
      setError("Group code not found.");
      setJoiningGroup(false);
      return;
    }

    await supabase.from("group_memberships").upsert(
      {
        user_id: userId,
        group_id: group.id,
        role: "member",
      },
      { onConflict: "user_id,group_id" }
    );

    const exists = groups.some((g) => g.id === group.id);
    const newGroups = exists ? groups : [group as Group, ...groups];
    setGroups(newGroups);
    setSelectedGroupId(group.id);
    await loadFeed(group.id);
    form.reset();
    setJoiningGroup(false);
  }

  async function handleCreatePost(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId || !selectedGroupId) return;
    setError(null);
    setPosting(true);

    const content = newContent.trim();
    if (!content) {
      setPosting(false);
      return;
    }

    const isPoll = postType === "poll";

    const { data: postRow, error: pErr } = await supabase
      .from("posts")
      .insert({
        group_id: selectedGroupId,
        author_id: userId,
        content,
        type: isPoll ? "poll" : "message",
        author_name: displayName,
      })
      .select("id")
      .single();

    if (pErr || !postRow) {
      console.error(pErr);
      setError("Failed to create post.");
      setPosting(false);
      return;
    }

    const postId = postRow.id as number;

    // Handle file uploads
    const input = fileInputRef.current;
    if (input && input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      const attachmentRows: Omit<Attachment, "id">[] = [] as any;

      for (const file of files) {
        const filePath = `${selectedGroupId}/${postId}/${Date.now()}-${file.name}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(filePath, file);

        if (uploadErr) {
          console.error(uploadErr);
          continue;
        }

        const { data: publicData } = supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .getPublicUrl(uploadData.path);

        attachmentRows.push({
          post_id: postId,
          url: publicData.publicUrl,
          original_name: file.name,
          mime_type: file.type,
          size: file.size,
        });
      }

      if (attachmentRows.length > 0) {
        const { error: aErr } = await supabase
          .from("file_attachments")
          .insert(attachmentRows as any);
        if (aErr) {
          console.error(aErr);
          setError("Some attachments failed to save.");
        }
      }
    }

    // Poll options
    if (isPoll) {
      const options = pollOptionsInput
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      if (options.length >= 2) {
        const rows = options.map((text) => ({ post_id: postId, text }));
        const { error: oErr } = await supabase
          .from("poll_options")
          .insert(rows as any);
        if (oErr) {
          console.error(oErr);
          setError("Failed to create poll options.");
        }
      }
    }

    setNewContent("");
    setPollOptionsInput(["", ""]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await loadFeed(selectedGroupId);
    setPosting(false);
  }

  async function handleCreateComment(
    e: FormEvent<HTMLFormElement>,
    postId: number
  ) {
    e.preventDefault();
    if (!userId || !selectedGroupId) return;
    const form = e.currentTarget;
    const content = (form.elements.namedItem("content") as HTMLInputElement).value.trim();
    if (!content) return;

    const { error: cErr } = await supabase.from("comments").insert({
      post_id: postId,
      author_id: userId,
      content,
      author_name: displayName,
    });

    if (cErr) {
      console.error(cErr);
      setError("Failed to add comment.");
      return;
    }

    form.reset();
    await loadFeed(selectedGroupId);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function handleDeleteGroup() {
    if (!selectedGroupId) return;
    if (!window.confirm("Delete this group and all its posts?") ) return;
    const { error } = await supabase.from("groups").delete().eq("id", selectedGroupId);
    if (error) {
      console.error(error);
      setError("Failed to delete group.");
      return;
    }
    const remaining = groups.filter((g) => g.id !== selectedGroupId);
    setGroups(remaining);
    if (remaining.length > 0) {
      setSelectedGroupId(remaining[0].id);
      await loadFeed(remaining[0].id);
    } else {
      setSelectedGroupId(null);
      setFeed([]);
      setComments([]);
      setAttachments([]);
      setPollOptions([]);
      setPollVotes([]);
    }
  }

  async function handleVote(postId: number, optionId: number) {
    if (!userId || !selectedGroupId) return;
    const { error } = await supabase
      .from("poll_votes")
      .upsert(
        {
          post_id: postId,
          option_id: optionId,
          user_id: userId,
        },
        { onConflict: "post_id,user_id" }
      );
    if (error) {
      console.error(error);
      setError("Failed to vote.");
      return;
    }
    await loadFeed(selectedGroupId);
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100">
      <header className="h-14 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950/80">
        <div className="font-bold">SportsMe</div>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span>{displayName}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-300 hover:text-white"
          >
            Logout
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-slate-800 p-4 bg-slate-950/70">
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wide mb-2">
              Your Groups
            </h3>
            <ul className="space-y-1 text-sm">
              {groups.length === 0 && (
                <li className="text-slate-500">No groups yet</li>
              )}
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    className={`w-full text-left px-2 py-1 rounded-md hover:bg-slate-800 ${
                      selectedGroupId === g.id ? "bg-slate-800" : ""
                    }`}
                    onClick={() => {
                      setSelectedGroupId(g.id);
                      loadFeed(g.id);
                    }}
                  >
                    <div>{g.name}</div>
                    <div className="text-[11px] text-slate-500">Code: {g.code}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wide mb-2">
              Create Group
            </h3>
            <form onSubmit={handleCreateGroup} className="space-y-2 text-sm">
              <input
                type="text"
                name="name"
                placeholder="Group name"
                className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-sm"
              />
              <button
                type="submit"
                disabled={creatingGroup}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-60"
              >
                {creatingGroup ? "Creating..." : "Create"}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wide mb-2">
              Join Group
            </h3>
            <form onSubmit={handleJoinGroup} className="space-y-2 text-sm">
              <input
                type="text"
                name="code"
                placeholder="Enter code"
                className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-sm"
              />
              <button
                type="submit"
                disabled={joiningGroup}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-60"
              >
                {joiningGroup ? "Joining..." : "Join"}
              </button>
            </form>
          </div>
        </aside>

        <main className="flex-1 p-4 overflow-y-auto">
          {error && (
            <div className="mb-3 text-sm bg-red-900/60 text-red-100 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-slate-400 text-sm">Loading...</div>
          ) : !selectedGroup ? (
            <div className="text-slate-400 text-sm">
              Select or create a group to get started.
            </div>
          ) : (
            <>
              <section className="border-b border-slate-800 pb-3 mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedGroup.name}</h2>
                  <div className="text-xs text-slate-400">
                    Code: <span className="font-mono">{selectedGroup.code}</span>
                  </div>
                </div>
                {selectedGroup.owner_id === userId && (
                  <button
                    onClick={handleDeleteGroup}
                    className="px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 text-xs"
                  >
                    Delete Group
                  </button>
                )}
              </section>

              <section className="bg-slate-950 border border-slate-800 rounded-lg p-3 mb-4">
                <h3 className="text-sm font-semibold mb-2">New Post</h3>
                <form onSubmit={handleCreatePost} className="space-y-2">
                  <textarea
                    name="content"
                    rows={3}
                    placeholder={postType === "poll" ? "Type a poll question" : "Type a message"}
                    value={newContent}
                    onChange={(e: any) => setNewContent(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-sm"
                  />
                  <div className="flex items-center gap-4 text-xs text-slate-300">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="postType"
                        value="message"
                        checked={postType === "message"}
                        onChange={() => setPostType("message")}
                      />
                      Message
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="postType"
                        value="poll"
                        checked={postType === "poll"}
                        onChange={() => setPostType("poll")}
                      />
                      Poll
                    </label>
                  </div>
                  {postType === "poll" && (
                    <div className="space-y-2 text-xs">
                      {pollOptionsInput.map((opt, idx) => (
                        <input
                          key={idx}
                          type="text"
                          value={opt}
                          onChange={(e: any) => {
                            const copy = [...pollOptionsInput];
                            copy[idx] = e.target.value;
                            setPollOptionsInput(copy);
                          }}
                          placeholder={`Option ${idx + 1}`}
                          className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-xs"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => setPollOptionsInput([...pollOptionsInput, ""])}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs"
                      >
                        + Add option
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="text-slate-300">
                      <label className="cursor-pointer">
                        Attach files
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="ml-2 text-xs"
                        />
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={posting}
                      className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-sm disabled:opacity-60"
                    >
                      {posting ? "Posting..." : "Post"}
                    </button>
                  </div>
                </form>
              </section>

              <section className="space-y-3">
                {feed.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    No posts yet. Be the first to post!
                  </div>
                ) : (
                  feed.map((p) => {
                    const postComments = comments.filter((c) => c.post_id === p.id);
                    const postAttachments = attachments.filter((a) => a.post_id === p.id);

                    const isPollPost = p.type === "poll";
                    const optionsForPost = pollOptions.filter((o) => o.post_id === p.id);
                    let totalVotes = 0;
                    const optionCounts = optionsForPost.map((o) => {
                      const votes = pollVotes.filter((v) => v.option_id === o.id);
                      const count = votes.length;
                      totalVotes += count;
                      return { option: o, count };
                    });
                    const userVote = userId
                      ? pollVotes.find((v) => v.post_id === p.id && v.user_id === userId)
                      : null;

                    return (
                      <article
                        key={p.id}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm"
                      >
                        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                          <span>{p.author_name || (isPollPost ? "Poll" : "Message")}</span>
                          <span>
                            {new Date(p.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="mb-2 whitespace-pre-wrap break-words">
                          {p.content}
                        </div>

                        {postAttachments.length > 0 && (
                          <div className="mb-2 space-y-1 text-xs">
                            {postAttachments.map((a) =>
                              a.mime_type.startsWith("image/") ? (
                                <div key={a.id} className="border border-slate-800 rounded-md overflow-hidden">
                                  <img src={a.url} alt={a.original_name} className="max-w-full" />
                                </div>
                              ) : (
                                <div key={a.id}>
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-400 hover:underline"
                                  >
                                    {a.original_name}
                                  </a>
                                </div>
                              )
                            )}
                          </div>
                        )}

                        {isPollPost && optionsForPost.length > 0 && (
                          <section className="mb-2 border border-slate-800 rounded-md p-2 text-xs space-y-1">
                            {optionCounts.map(({ option, count }) => {
                              const percent = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
                              const selected = userVote && userVote.option_id === option.id;
                              return (
                                <label
                                  key={option.id}
                                  className="flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name={`poll-${p.id}`}
                                      checked={!!selected}
                                      onChange={() => handleVote(p.id, option.id)}
                                    />
                                    <span>{option.text}</span>
                                  </span>
                                  <span className="text-slate-400">
                                    {count} ({percent}%)
                                  </span>
                                </label>
                              );
                            })}
                            <div className="text-[11px] text-slate-500 mt-1">
                              Total votes: {totalVotes}
                            </div>
                          </section>
                        )}

                        <section className="border-t border-slate-800 pt-2 mt-2">
                          <h4 className="text-xs font-semibold mb-1">Comments</h4>
                          {postComments.length === 0 ? (
                            <div className="text-xs text-slate-500 mb-1">
                              No comments yet.
                            </div>
                          ) : (
                            <ul className="space-y-1 mb-2 text-xs">
                              {postComments.map((c) => (
                                <li key={c.id} className="text-slate-200">
                                  <span className="text-slate-400 mr-1">
                                    {c.author_name ? `${c.author_name}  ` : ""}
                                    {new Date(c.created_at).toLocaleTimeString()}:
                                  </span>
                                  <span>{c.content}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <form
                            onSubmit={(e) => handleCreateComment(e, p.id)}
                            className="flex gap-2 text-xs"
                          >
                            <input
                              type="text"
                              name="content"
                              placeholder="Add a comment"
                              className="flex-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-xs"
                            />
                            <button
                              type="submit"
                              className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs"
                            >
                              Comment
                            </button>
                          </form>
                        </section>
                      </article>
                    );
                  })
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
