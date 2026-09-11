import { App, Modal, Setting } from "obsidian";

export class ConfirmationModal extends Modal {
	private resolveResult: (confirmed: boolean) => void = () => {};
	/** Resolves true once the user confirms, false when the dialog is dismissed. */
	readonly result: Promise<boolean>;

	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly confirmButtonText: string,
		private readonly onConfirm: () => void | Promise<void>,
	) {
		super(app);
		this.result = new Promise<boolean>((resolve) => {
			this.resolveResult = resolve;
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createEl("p", { text: this.message });

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("取消").onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(this.confirmButtonText)
					.setDestructive()
					.setCta()
					.onClick(async () => {
						this.resolveResult(true);
						this.close();
						await this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.resolveResult(false);
		this.contentEl.empty();
	}
}

