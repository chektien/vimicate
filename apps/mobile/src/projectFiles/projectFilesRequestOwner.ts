export class ProjectFilesRequestOwner {
  private generation = 0;
  private controllers = new Set<AbortController>();

  begin() {
    for (const existing of this.controllers) existing.abort();
    this.controllers.clear();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    return {
      generation,
      signal: controller.signal,
      current: () => generation === this.generation && !controller.signal.aborted,
      finish: () => this.controllers.delete(controller),
    };
  }

  invalidate() {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
