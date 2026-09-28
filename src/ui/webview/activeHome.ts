import * as vscode from 'vscode';

/** A widget Home can add, as its + Add widget list names it. */
export interface HomeWidgetChoice {
  value: string;
  label: string;
  description?: string;
}

/** Home, whose widgets the Related Notes sidebar can add while it is in front. */
export interface HomeSource {
  getWidgetChoices(): HomeWidgetChoice[];
  /** Adds a widget, putting Home into customizing first. */
  addWidget(value: string): void;
  /** Asks, then puts back the widgets Home starts with. */
  resetWidgets(): Promise<void>;
}

/**
 * Knows whether Home is the active editor, so Related Notes can offer its
 * widgets while it is: the same arrangement as ActiveSearch and
 * ActiveCalendar.
 */
export class ActiveHome implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private source: HomeSource | undefined;
  public readonly onDidChange = this.changeEmitter.event;

  public constructor() {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.setActive(undefined);
        }
      }),
    );
  }

  public get active(): HomeSource | undefined {
    return this.source;
  }

  public setActive(source: HomeSource | undefined): void {
    if (this.source !== source) {
      this.source = source;
      this.changeEmitter.fire();
    }
  }

  public release(source: HomeSource): void {
    if (this.source === source) {
      this.setActive(undefined);
    }
  }

  public notifyChanged(source: HomeSource): void {
    if (this.source === source) {
      this.changeEmitter.fire();
    }
  }

  public dispose(): void {
    this.source = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }
}
