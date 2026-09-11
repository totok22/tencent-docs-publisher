import { discoverLocalPageTree, type LocalPageRepository, type LocalTreeResult } from "../domain/local-page-tree";
import { bindingsFromProposals, proposeBindings, type BindingProposal } from "../domain/page-binding";
import { discoverRemotePageTree, resolveRemoteDocumentRoot } from "../domain/remote-page-tree";
import type { ToolJsonCaller } from "../tencent/smartcanvas";
import type { PublishProject, RemoteTreeCache } from "../types";

export interface RefreshBindingsResult {
	localTree: LocalTreeResult;
	proposals: BindingProposal[];
	cache: RemoteTreeCache;
	remoteUrl: string;
}

export async function refreshBindings(
	project: PublishProject,
	repository: LocalPageRepository,
	client: ToolJsonCaller,
	embeddedMarkdownAsPage = false,
): Promise<RefreshBindingsResult> {
	const localTree = await discoverLocalPageTree(repository, project.sourceRootPath, {
		allowedRootPath: project.allowedRootPath,
		maxDepth: project.maxDepth,
		maxNotes: project.maxNotes,
		embeddedMarkdownAsPage,
	});
	const root = await resolveRemoteDocumentRoot(client, project.remoteFileId);
	const remoteTree = await discoverRemotePageTree(client, project.remoteFileId, root.pageId, root.title);
	const proposals = proposeBindings(localTree.root, root.pageId, remoteTree.nodes, project.pageMap);
	return {
		localTree,
		proposals,
		cache: { projectId: project.id, fetchedAt: new Date().toISOString(), nodes: remoteTree.nodes },
		remoteUrl: root.remoteUrl,
	};
}

export function acceptAutomaticBindings(project: PublishProject, result: RefreshBindingsResult): void {
	project.pageMap = bindingsFromProposals(result.proposals, project.pageMap);
	project.remoteRootPageId = result.cache.nodes[project.remoteRootPageId]
		? project.remoteRootPageId
		: result.proposals[0]?.remotePageId ?? project.remoteRootPageId;
	if (result.remoteUrl) project.remoteUrl = result.remoteUrl;
}
