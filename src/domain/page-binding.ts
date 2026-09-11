import type { LocalPageNode } from "./local-page-tree";
import type { PublishProject, RemotePageBinding, RemotePageNode } from "../types";

export type BindingStatus = "matched" | "missing" | "ambiguous" | "hierarchy-changed";

export interface BindingProposal {
	localPath: string;
	localTitle: string;
	parentLocalPath: string | null;
	remotePageId: string | null;
	remoteTitle: string | null;
	status: BindingStatus;
	reason: string;
	candidatePageIds: string[];
}

export function proposeBindings(
	localRoot: LocalPageNode,
	remoteRootPageId: string,
	remoteNodes: Record<string, RemotePageNode>,
	existing: Record<string, RemotePageBinding>,
): BindingProposal[] {
	const proposals: BindingProposal[] = [];
	const assignedRemote = new Set<string>();
	const remoteByLocal = new Map<string, string>();

	function visit(local: LocalPageNode, parentLocalPath: string | null): void {
		const expectedParentId = parentLocalPath ? remoteByLocal.get(parentLocalPath) ?? null : null;
		const saved = existing[local.path];
		let proposal: BindingProposal;

		if (parentLocalPath === null) {
			const root = remoteNodes[remoteRootPageId];
			proposal = root
				? matched(local, null, root, "根页面")
				: missing(local, null, "远端根页面不存在。");
		} else if (saved && remoteNodes[saved.pageId]) {
			const remote = remoteNodes[saved.pageId];
			if (remote && remote.parentPageId !== expectedParentId) {
				proposal = {
					localPath: local.path,
					localTitle: local.title,
					parentLocalPath,
					remotePageId: saved.pageId,
					remoteTitle: remote.title,
					status: "hierarchy-changed",
					reason: "已保存的 Page ID 仍存在，但远端父级已变化，需要用户确认。",
					candidatePageIds: [saved.pageId],
				};
			} else {
				proposal = matched(local, parentLocalPath, remote!, "已保存的 Page ID");
			}
		} else if (saved) {
			proposal = missing(local, parentLocalPath, "已保存的远端 Page ID 不再存在。");
		} else if (!expectedParentId) {
			proposal = missing(local, parentLocalPath, "父页面尚未绑定。");
		} else {
			const parent = remoteNodes[expectedParentId];
			const children = (parent?.childPageIds ?? [])
				.map((id) => remoteNodes[id])
				.filter((node): node is RemotePageNode => node !== undefined && !assignedRemote.has(node.pageId));
			proposal = matchByTitles(local, parentLocalPath, children);
		}

		proposals.push(proposal);
		if (proposal.status === "matched" && proposal.remotePageId) {
			assignedRemote.add(proposal.remotePageId);
			remoteByLocal.set(local.path, proposal.remotePageId);
		}
		for (const child of local.children) visit(child, local.path);
	}

	visit(localRoot, null);
	return proposals;
}

export function bindingsFromProposals(
	proposals: BindingProposal[],
	existing: PublishProject["pageMap"],
): PublishProject["pageMap"] {
	const output: PublishProject["pageMap"] = { ...existing };
	for (const proposal of proposals) {
		if (proposal.status !== "matched" || !proposal.remotePageId || !proposal.remoteTitle) continue;
		const previous = existing[proposal.localPath];
		output[proposal.localPath] = {
			pageId: proposal.remotePageId,
			parentPageId: proposal.parentLocalPath
				? proposals.find((candidate) => candidate.localPath === proposal.parentLocalPath)?.remotePageId ?? null
				: null,
			localTitle: proposal.localTitle,
			remoteTitle: proposal.remoteTitle,
			...(previous?.lastPublishedSourceHash ? { lastPublishedSourceHash: previous.lastPublishedSourceHash } : {}),
			...(previous?.lastPublishedRemoteHash ? { lastPublishedRemoteHash: previous.lastPublishedRemoteHash } : {}),
			...(previous?.lastPublishedAt ? { lastPublishedAt: previous.lastPublishedAt } : {}),
		};
	}
	return output;
}

export function bindingsFromSelections(
	proposals: BindingProposal[],
	selections: Record<string, string>,
	remoteNodes: Record<string, RemotePageNode>,
	existing: PublishProject["pageMap"],
): PublishProject["pageMap"] {
	const used = new Set<string>();
	const selectedProposals = proposals.map((proposal) => {
		const pageId = selections[proposal.localPath];
		if (!pageId) return { ...proposal, status: "missing" as const, remotePageId: null, remoteTitle: null };
		const remote = remoteNodes[pageId];
		if (!remote) throw new Error(`远端页面不存在：${pageId}`);
		if (used.has(pageId)) throw new Error(`同一远端页面不能绑定多个本地页面：${remote.title}`);
		used.add(pageId);
		const parentId = proposal.parentLocalPath ? selections[proposal.parentLocalPath] : null;
		if (remote.parentPageId !== parentId) {
			const actualParent = remote.parentPageId ? remoteNodes[remote.parentPageId]?.title ?? remote.parentPageId : "文档根级";
			const selectedParent = parentId ? remoteNodes[parentId]?.title ?? parentId : "文档根级";
			throw new Error(
				`页面“${remote.title}”的远端父页面是“${actualParent}”，但本地父页面绑定到“${selectedParent}”。请先调整本地或腾讯文档的页面层级。`,
			);
		}
		return {
			...proposal,
			status: "matched" as const,
			remotePageId: pageId,
			remoteTitle: remote.title,
		};
	});
	return bindingsFromProposals(selectedProposals, existing);
}

function matchByTitles(
	local: LocalPageNode,
	parentLocalPath: string,
	children: RemotePageNode[],
): BindingProposal {
	const filename = local.path.split("/").pop()?.replace(/\.md$/i, "") ?? local.title;
	const strategies: Array<[string, (remote: RemotePageNode) => boolean]> = [
		["frontmatter title", (remote) => remote.title === local.title],
		["文件名", (remote) => remote.title === filename],
		["alias", (remote) => local.aliases.includes(remote.title)],
	];
	for (const [reason, predicate] of strategies) {
		const matches = children.filter(predicate);
		if (matches.length === 1 && matches[0]) return matched(local, parentLocalPath, matches[0], reason);
		if (matches.length > 1) {
			return {
				localPath: local.path,
				localTitle: local.title,
				parentLocalPath,
				remotePageId: null,
				remoteTitle: null,
				status: "ambiguous",
				reason: `同一父页面下有多个 ${reason} 匹配。`,
				candidatePageIds: matches.map((match) => match.pageId),
			};
		}
	}
	return missing(local, parentLocalPath, "同一父页面下没有匹配的远端子页面。");
}

function matched(
	local: LocalPageNode,
	parentLocalPath: string | null,
	remote: RemotePageNode,
	reason: string,
): BindingProposal {
	return {
		localPath: local.path,
		localTitle: local.title,
		parentLocalPath,
		remotePageId: remote.pageId,
		remoteTitle: remote.title,
		status: "matched",
		reason,
		candidatePageIds: [remote.pageId],
	};
}

function missing(local: LocalPageNode, parentLocalPath: string | null, reason: string): BindingProposal {
	return {
		localPath: local.path,
		localTitle: local.title,
		parentLocalPath,
		remotePageId: null,
		remoteTitle: null,
		status: "missing",
		reason,
		candidatePageIds: [],
	};
}
