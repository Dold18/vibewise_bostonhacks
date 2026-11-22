import type { Rect } from './popupPlacement';
export interface LabelCandidate { id: number; rect: Rect; priority: number }
const overlaps = (a: Rect, b: Rect, gap = 7) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
/** Screen-space collision handling works for DOM pins in both tilted and flat views. */
export function choosePinLabels(candidates: LabelCandidate[], pins: Rect[], obstacles: Rect[], bounds: Rect): Set<number> {
  const selected = new Set<number>(), placed: Rect[] = [];
  for (const c of [...candidates].sort((a,b) => b.priority-a.priority || a.id-b.id)) {
    const r = c.rect;
    if (r.left < bounds.left+6 || r.right > bounds.right-6 || r.top < bounds.top+6 || r.bottom > bounds.bottom-6) continue;
    if (obstacles.some(o => overlaps(r,o)) || placed.some(o => overlaps(r,o))) continue;
    // Hover/focus may reveal one name over a dense pin cluster, displacing quieter labels.
    if (c.priority < 3 && pins.some(p => overlaps(r,p,2))) continue;
    selected.add(c.id); placed.push(r);
  }
  return selected;
}

export function createPinLabels(container: HTMLElement, getObstacles: () => Element[]) {
  let frame: number | undefined;
  let destroyed = false;
  const previous = new WeakSet<HTMLElement>();
  function render() {
    frame = undefined;
    const bounds = container.getBoundingClientRect();
    const entries: { pin: HTMLElement; label: HTMLElement; body: DOMRect; priority: number }[] = [];
    const all = [...container.querySelectorAll<HTMLElement>('.pin, .vb-trip-destination')];
    for (const pin of all) {
      let label = pin.querySelector<HTMLElement>('.pin-name');
      const name = pin.getAttribute('aria-label')?.replace(/^Destination: /, '');
      if (!name) continue;
      if (!label) {
        label = document.createElement('span'); label.className = 'pin-name'; label.setAttribute('aria-hidden','true'); pin.append(label);
      }
      if (label.textContent !== name) label.textContent = name;
      const style = getComputedStyle(pin);
      if (pin.inert || style.visibility === 'hidden' || style.display === 'none') { label.classList.remove('is-visible'); continue; }
      const active = pin.matches(':hover, :focus-within');
      const priority = active ? 3 : pin.classList.contains('selected') || pin.classList.contains('vb-trip-destination') ? 2 : previous.has(pin) ? .25 : 0;
      label.classList.toggle('is-priority', priority >= 2);
      const body = (pin.querySelector('.pin-body') ?? pin).getBoundingClientRect();
      entries.push({pin,label,body,priority});
    }
    const obstacles = getObstacles().filter(el => (el as HTMLElement).offsetParent !== null).map(el => el.getBoundingClientRect());
    const candidates = entries.map(({pin,label,body,priority},id) => {
      const width = label.offsetWidth, height = label.offsetHeight;
      const left = Math.max(bounds.left+8, Math.min(bounds.right-width-8, body.left+body.width/2-width/2));
      const top = body.top-height-10;
      const root = pin.getBoundingClientRect();
      label.style.left = `${left-root.left}px`; label.style.top = `${top-root.top}px`;
      return {id,priority,rect:{left,top,right:left+width,bottom:top+height}};
    });
    const chosen = choosePinLabels(candidates,entries.map(e=>e.body),obstacles,bounds);
    entries.forEach(({pin,label},i) => {
      const visible = chosen.has(i); label.classList.toggle('is-visible',visible);
      if (visible) previous.add(pin); else previous.delete(pin);
    });
  }
  const schedule = () => { if(!destroyed && frame===undefined) frame=requestAnimationFrame(render); };
  document.fonts.addEventListener('loadingdone',schedule);
  void document.fonts.ready.then(schedule);
  const observer = new MutationObserver(schedule); observer.observe(container,{childList:true,subtree:true});
  const resize = new ResizeObserver(schedule); resize.observe(container); getObstacles().forEach(el=>resize.observe(el));
  for (const event of ['pointerover','pointerout','focusin','focusout','transitionend']) container.addEventListener(event,schedule);
  schedule();
  return { schedule, destroy() { destroyed=true; document.fonts.removeEventListener('loadingdone',schedule); if(frame!==undefined) cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); for(const event of ['pointerover','pointerout','focusin','focusout','transitionend']) container.removeEventListener(event,schedule); } };
}
