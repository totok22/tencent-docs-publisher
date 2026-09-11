import { Modal, Notice, Setting } from "obsidian";
import type { BindingProposal } from "../domain/page-binding";
import type { RemotePageNode } from "../types";

const PROPOSAL_LABEL: Record<BindingProposal["status"], string> = {
	matched: "已自动匹配",
	missing: "腾讯文档里还没有对应页面",
	ambiguous: "有多个同名页面，需要手动选择",
	"hierarchy-changed": "远端层级变了，需要重新确认",
};

export class BindingModal extends Modal {
	constructor(
		app: ConstructorParameters<typeof Modal>[0],
		private readonly proposals: BindingProposal[],
		private readonly remoteNodes: Record<string, RemotePageNode>,
		private readonly onSave: (selections: Record<string, string>) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("页面绑定");
		this.contentEl.createEl("p", {
			text: "设置本地笔记与腾讯文档页面的对应关系。",
		});
		if (this.proposals.some((proposal) => proposal.status === "missing")) {
			this.contentEl.createEl("p", {
				text: "未匹配的页面需先在腾讯文档中创建对应子页面，再刷新匹配。",
			});
		}
		const selections: Record<string, string> = {};
		const proposalsByPath = new Map(this.proposals.map((proposal) => [proposal.localPath, proposal]));
		const depths = new Map<string, number>();
		const remoteNodes = Object.values(this.remoteNodes);
		for (const proposal of this.proposals) {
			const depth = pathDepth(proposal.localPath, proposalsByPath, depths);
			const setting = new Setting(this.contentEl)
				.setName("　".repeat(depth) + statusIcon(proposal.status) + " " + proposal.localTitle)
				.setDesc(proposal.localPath + "\n" + PROPOSAL_LABEL[proposal.status]);
			setting.addDropdown((dropdown) => {
				dropdown.addOption("", "（未绑定）");
				for (const node of remoteNodes) dropdown.addOption(node.pageId, node.title);
				if (proposal.remotePageId) {
					dropdown.setValue(proposal.remotePageId);
					selections[proposal.localPath] = proposal.remotePageId;
				}
				dropdown.onChange((value) => {
					if (value) selections[proposal.localPath] = value;
					else delete selections[proposal.localPath];
				});
			});
		}
		const initiallyBound = new Set(this.proposals.map((proposal) => proposal.remotePageId).filter(Boolean));
		const unbound = remoteNodes.filter((node) => !initiallyBound.has(node.pageId));
		if (unbound.length) {
			this.contentEl.createEl("h3", { text: "远端其他页面" });
			for (const node of unbound) this.contentEl.createEl("p", { text: "○ " + node.title + "（" + node.pageId + "）" });
		}
		new Setting(this.contentEl).addButton((button) =>
			button.setCta().setButtonText("保存绑定").onClick(async () => {
				try {
					await this.onSave(selections);
					this.close();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "保存绑定失败。");
				}
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function pathDepth(
	path: string,
	proposalsByPath: ReadonlyMap<string, BindingProposal>,
	depths: Map<string, number>,
): number {
	const cached = depths.get(path);
	if (cached !== undefined) return cached;
	let depth = 0;
	let parent = proposalsByPath.get(path)?.parentLocalPath ?? null;
	while (parent) {
		depth += 1;
		parent = proposalsByPath.get(parent)?.parentLocalPath ?? null;
	}
	depths.set(path, depth);
	return depth;
}

function statusIcon(status: BindingProposal["status"]): string {
	return { matched: "✓", missing: "!", ambiguous: "?", "hierarchy-changed": "↕" }[status];
}

