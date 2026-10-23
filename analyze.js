// Serverless Function: /api/analyze
// Compatible with Vercel Serverless Functions (Node.js 18+)

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET = health check so you can test in browser
  if (req.method === 'GET') {
    const apiKey = process.env.GEMINI_API_KEY;
    return res.status(200).json({
      status: 'ok',
      endpoint: '/api/analyze',
      apiKeyConfigured: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 6) + '...' : 'NOT SET',
      usage: 'POST with { "image": "<base64>", "mimeType": "image/jpeg" }'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { image, mimeType } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'No image provided in request body. Send { "image": "<base64>", "mimeType": "image/jpeg" }' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not set.',
        fix: 'Go to Vercel → your project → Settings → Environment Variables → add GEMINI_API_KEY → Redeploy.'
      });
    }

    // Strip data URL prefix if present (e.g. data:image/jpeg;base64,...)
    const cleanBase64 = image.includes(',') ? image.split(',')[1] : image;
    const mediaType = mimeType || 'image/jpeg';

    const prompt = `You are an expert Indian fashion stylist and e-commerce product matcher.
Look closely at the outfit worn in this photograph.
Analyze and isolate every specific clothing item, shoe, bag, and accessory visible.

Generate a strictly valid JSON response in this exact format:
{
  "outfitTitle": "Short stylish title describing the look (e.g. Oversized Leather Biker Chic, Monochromatic Linen Minimalist)",
  "aestheticVibe": "Key aesthetic (e.g. Downtown Girl, Office Siren, Old Money, Coquette, Tomato Girl)",
  "pieces": [
    {
      "category": "Outerwear/Top/Bottom/Dress/Footwear/Bag/Jewelry",
      "name": "Exact garment name (e.g. Chocolate Brown Cropped Leather Jacket)",
      "searchQuery": "Precise 3-4 word shopping search term for Indian stores (e.g. brown cropped leather jacket women)",
      "description": "Details on fit, collar, cut, and material (e.g. Boxy fit, lapel collar, silver zip)",
      "estimatedPrice": "Estimated price range in India (e.g. ₹1,499 - ₹2,999)"
    }
  ]
}

Be specific about colors, silhouettes, and fabrics so the search queries find near-identical pieces on Myntra, Ajio, and Zara India.`;

    // Try gemini-2.0-flash first (stable), fallback to gemini-1.5-flash
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastError = null;

    for (const model of models) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const requestBody = {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mediaType,
                    data: cleanBase64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        };

        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`Model ${model} failed:`, errText);
          lastError = { model, status: response.status, details: errText };
          continue; // try next model
        }

        const data = await response.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidateText) {
          lastError = { model, error: 'Empty response from model' };
          continue;
        }

        const parsedResult = JSON.parse(candidateText);
        return res.status(200).json(parsedResult);

      } catch (modelErr) {
        console.error(`Model ${model} error:`, modelErr.message);
        lastError = { model, error: modelErr.message };
        continue;
      }
    }

    // All models failed
    return res.status(502).json({
      error: 'All Gemini models failed to process the image.',
      lastError,
      fix: 'Check that your GEMINI_API_KEY is valid at https://aistudio.google.com/app/apikey'
    });

  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
