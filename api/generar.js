// Función de Vercel: pide a Gemini una foto realista de cuerpo entero con las medidas y el tono de piel.
// La clave vive solo aquí, en la variable de entorno GEMINI_API_KEY (nunca llega al navegador).
const MODELO = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function texto(p) {
  const m = p.medidas || {};
  const mujer = p.sexo === 'f';
  const dato = (k, nombre, u = 'cm') => (m[k] ? `${nombre} ${m[k]} ${u}` : null);
  const datos = [
    dato('altura', 'height'), p.peso ? `weight ${p.peso} kg` : null,
    dato('cuello', 'neck circumference'), dato('hombros', 'shoulder circumference'),
    dato('biceps', 'flexed biceps circumference'), dato('cintura', 'waist circumference at the navel'),
    dato('cadera', 'hip circumference at the buttocks'), dato('muslo', 'thigh circumference'),
    dato('gemelo', 'calf circumference')
  ].filter(Boolean).join(', ');
  const imc = m.altura && p.peso ? (p.peso / Math.pow(m.altura / 100, 2)).toFixed(1) : null;
  return [
    `Photorealistic full-body photograph of an adult ${mujer ? 'woman' : 'man'} for a body-measurement record.`,
    datos ? `${mujer ? "Her" : "His"} real body measurements are: ${datos}${imc ? ` (BMI ${imc})` : ''}. The body shape, proportions, belly, chest, arms and legs must honestly match these measurements, without idealizing or slimming.` : '',
    p.piel ? 'Skin tone and skin texture must match exactly the skin in the attached close-up photo of the person\'s inner forearm, applied naturally to the whole body with realistic shading.' : `Skin tone: ${p.tono || 'medium'}.`,
    `Wearing only plain black fitted shorts${mujer ? ' and a plain black sports top' : ''}. Barefoot, feet fully visible.`,
    'Standing straight facing the camera in a relaxed anatomical position: arms hanging slightly away from the body, palms toward the thighs, feet hip-width apart, neutral expression.',
    'Entire body visible from the top of the head to the soles of the feet, centered, with a small margin above the head and below the feet.',
    'Plain pure white seamless studio background, soft even lighting, camera at waist height, straight-on view, no perspective distortion.',
    'No text, no logos, no measuring tapes, no lines, no rulers, no jewelry, no watch, no tattoos, no glasses.'
  ].filter(Boolean).join(' ');
}

function sacarImagen(j) {
  // generateContent: candidates[].content.parts[].inlineData
  for (const c of j.candidates || []) for (const part of (c.content && c.content.parts) || []) {
    const d = part.inlineData || part.inline_data;
    if (d && d.data) return { mime: d.mimeType || d.mime_type || 'image/png', data: d.data };
  }
  // Interactions API: output_image o pasos con bloques de imagen
  const oi = j.output_image || j.outputImage;
  if (oi && oi.data) return { mime: oi.mime_type || oi.mimeType || 'image/png', data: oi.data };
  for (const s of j.steps || j.outputs || []) for (const b of [].concat(s.content || s.output || s)) {
    if (b && b.type === 'image' && b.data) return { mime: b.mime_type || 'image/png', data: b.data };
  }
  return null;
}

async function llamar(url, cuerpo, clave) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST.' });
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) return res.status(500).json({ error: 'Falta configurar la clave GEMINI_API_KEY en Vercel.' });
  // Solo se aceptan pedidos desde la propia página del cuarto
  const origen = req.headers.origin || '';
  if (origen && !/^https:\/\/cuarto-1fit[\w-]*\.vercel\.app$/.test(origen)) return res.status(403).json({ error: 'Origen no permitido.' });

  const p = req.body || {};
  const prompt = texto(p);
  const partes = [{ text: prompt }];
  if (p.piel) partes.push({ inline_data: { mime_type: 'image/jpeg', data: p.piel } });

  // 1) generateContent (forma clásica)
  let r = await llamar(`${BASE}/models/${MODELO}:generateContent`, {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }
  }, clave);
  let img = r.ok ? sacarImagen(r.j) : null;

  // 2) Interactions API (forma nueva), si la clásica no devolvió imagen
  if (!img) {
    const entrada = [{ type: 'text', text: prompt }];
    if (p.piel) entrada.push({ type: 'image', mime_type: 'image/jpeg', data: p.piel });
    const r2 = await llamar(`${BASE}/interactions`, { model: MODELO, input: entrada, response_format: { type: 'image', aspect_ratio: '9:16' } }, clave);
    img = r2.ok ? sacarImagen(r2.j) : null;
    if (!img) {
      const msg = (r.j.error && r.j.error.message) || (r2.j.error && r2.j.error.message) || 'Gemini no devolvió una imagen.';
      return res.status(502).json({ error: msg, estado: [r.status, r2.status] });
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ imagen: `data:${img.mime};base64,${img.data}` });
};
