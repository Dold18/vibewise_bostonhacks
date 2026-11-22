// Summarizes /private/tmp/vibenta-media-qa/report.json into per-run evidence rows.
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2] ?? '/private/tmp/vibenta-media-qa/report.json', 'utf8'));
console.log(`geminiConfigured=${r.geminiConfigured} playback=${JSON.stringify(r.playback && { ok: r.playback.ok, videoId: r.playback.videoId, currentTime: r.playback.currentTime, paused: r.playback.paused, muted: r.playback.muted, error: r.playback.error })}`);
for (const run of r.runs) {
  console.log(`\n## ${run.input} [${run.path}]${run.errors.length ? ` ERRORS: ${run.errors.join('; ')}` : ''}${run.pageErrors?.length ? ` PAGE ERRORS: ${run.pageErrors.slice(0, 3).join(' | ')}` : ''}`);
  let lastScene = null;
  run.steps.forEach((s, i) => {
    const p = s.question?.presentation;
    const media = p ? [...(p.optionImages?.map((o) => o.imageId) ?? []), p.stageImageId, p.trackId].filter(Boolean).join(', ') : s.sceneStep ? `sessionB ${s.sceneStep}` : '';
    const imgs = s.images.length ? ` imgs ${s.images.filter((x) => x.loaded && x.visible).length}/${s.images.length} loaded` : '';
    const sceneChanged = s.scene && lastScene && s.scene.hash !== lastScene ? ' MAP-SCENE-CHANGED' : '';
    lastScene = s.scene?.hash ?? lastScene;
    console.log(`${i + 1}. [${s.phase}/${s.generation}] ${p ? `${p.source}:${p.format} voice=${p.voice} mood=${p.mood}` : s.sceneStep ? 'session-b' : 'legacy-text'} quizMood=${s.quizMood}${imgs}${sceneChanged}`);
    if (s.question) console.log(`   Q: ${s.question.prompt}`);
    if (media) console.log(`   media: ${media}${p?.referenceIds?.length ? ` refs: ${p.referenceIds.join(',')}` : ''}`);
    if (p?.design) console.log(`   uncertainty: ${p.design.uncertainty}`);
    console.log(`   answered: ${s.answered ?? '-'} | scene presets: ${s.scene?.presets} | ranking: ${s.ranking?.status} ${s.ranking?.reason ?? ''}`);
  });
  if (run.final) console.log(`final: phase=${run.final.phase} embedding=${run.final.embedding} presets=${run.final.scene?.presets} ranking=${run.final.ranking?.status}: ${run.final.ranking?.reason}`);
}
