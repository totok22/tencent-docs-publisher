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
			text: "把每篇本地笔记对应到腾讯文档里的一个页面。保存只更新插件记录，不会修改腾讯文档。",
		});
		if (this.proposals.some((proposal) => proposal.status === "missing")) {
			this.contentEl.createEl("p", {
				text: "标着“还没有对应页面”的条目，需要先在腾讯文档里用子页面卡片建好同名页面，再用「刷新远端页面树」重新匹配。",
			});
		}
		const selections: Record<string, string> = {};
		for (const proposal of this.proposals) {
			const depth = pathDepth(proposal.localPath, this.proposals);
			const setting = new Setting(this.contentEl)
				.setName("　".repeat(depth) + statusIcon(proposal.status) + " " + proposal.localTitle)
				.setDesc(proposal.localPath + "\n" + PROPOSAL_LABEL[proposal.status]);
			setting.addDropdown((dropdown) => {
				dropdown.addOption("", "（未绑定）");
				for (const node of Object.values(this.remoteNodes)) dropdown.addOption(node.pageId, node.title);
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
		const unbound = Object.values(this.remoteNodes).filter((node) => !initiallyBound.has(node.pageId));
		if (unbound.length) {
			this.contentEl.createEl("h3", { text: "腾讯文档里多出来的页面（发布不会动它们）" });
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

function pathDepth(path: string, proposals: BindingProposal[]): number {
	let depth = 0;
	let parent = proposals.find((proposal) => proposal.localPath === path)?.parentLocalPath ?? null;
	while (parent) {
		depth += 1;
		parent = proposals.find((proposal) => proposal.localPath === parent)?.parentLocalPath ?? null;
	}
	return depth;
}

function statusIcon(status: BindingProposal["status"]): string {
	return { matched: "✓", missing: "!", ambiguous: "?", "hierarchy-changed": "↕" }[status];
}

