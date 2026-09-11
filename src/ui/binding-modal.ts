import { Modal, Notice, Setting } from "obsidian";
import type { BindingProposal } from "../domain/page-binding";
import type { RemotePageNode } from "../types";

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
		this.titleEl.setText("腾讯文档页面绑定");
		this.contentEl.createEl("p", {
			text: "保存绑定不会开始发布。缺失页面请先在腾讯文档中手动创建，再刷新远端页面树。",
		});
		const selections: Record<string, string> = {};
		for (const proposal of this.proposals) {
			const depth = pathDepth(proposal.localPath, this.proposals);
			const setting = new Setting(this.contentEl)
				.setName(`${"　".repeat(depth)}${statusIcon(proposal.status)} ${proposal.localTitle}`)
				.setDesc(`${proposal.localPath}\n${proposal.reason}`);
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
			this.contentEl.createEl("h3", { text: "未绑定的远端页面（不会修改）" });
			for (const node of unbound) this.contentEl.createEl("p", { text: `○ ${node.title} (${node.pageId})` });
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
