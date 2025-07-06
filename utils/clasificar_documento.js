const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function clasificarDocumentoNode(imageUrl) {
    const prompt = `¿Qué tipo de documento es esta imagen? Solo responde una de estas categorías en minúsculas y en español, sin más texto:
- comprobante_pago
- listado_examenes
- confirmacion_consulta
- desconocido`;
    const body = {
        model: "gpt-4-vision-preview",
        messages: [
            {
                role: "system",
                content: prompt
            },
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: imageUrl }
                ]
            }
        ],
        max_tokens: 10
    };
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const data = await response.json();
    // El resultado debe ser exactamente la categoría, sin adornos
    return data.choices?.[0]?.message?.content?.trim() || "desconocido";
}
