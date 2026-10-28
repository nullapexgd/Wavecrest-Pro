/** Where the two Blender-made models come from: files normally, embedded data in the single-file build. */
export async function modelUrls(base: string): Promise<{ lead: string; pennant: string }> {
  if (__INLINE_MODELS__) {
    const [lead, pennant] = await Promise.all([
      import('../../static/models/lead.glb?inline'),
      import('../../static/models/pennant.glb?inline')
    ]);
    return { lead: lead.default, pennant: pennant.default };
  }
  return { lead: `${base}models/lead.glb`, pennant: `${base}models/pennant.glb` };
}
