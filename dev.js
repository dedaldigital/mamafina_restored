require('dotenv').config();

// dev.js
// Script de desarrollo para arrancar:
// 1) vercel dev en puerto 3000
// 2) esperar 3 segundos
// 3) arrancar ngrok http 3000 --log=stdout
// 4) leer la URL pública desde http://localhost:4040/api/tunnels
// 5) esperar hasta que esa URL esté disponible (15 intentos, 1s)
// 6) actualizar el webhook de Telegram con URL + /api/webhook
// 7) mostrar en consola la URL final

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!TELEGRAM_TOKEN) {
    console.error('❌ Falta TELEGRAM_TOKEN en process.env');
    process.exit(1);
}

// Helper: pequeño delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: llamada HTTPS sencilla para setWebhook
function setTelegramWebhook(url, token) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ url });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${token}/setWebhook`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => (body += chunk.toString()));
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (!json.ok) {
                        return reject(
                            new Error(`Telegram respondió ok=false: ${body}`)
                        );
                    }
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Helper: leer URL pública de ngrok desde su API local
function getNgrokPublicUrl() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 4040,
            path: '/api/tunnels',
            method: 'GET'
        };

        const req = http.request(options, res => {
            let body = '';
            res.on('data', chunk => (body += chunk.toString()));
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    const tunnels = json.tunnels || [];
                    if (!tunnels.length) {
                        return reject(new Error('No hay túneles en ngrok aún'));
                    }

                    // Preferimos HTTPS si existe
                    let publicUrl =
                        tunnels.find(t => t.public_url.startsWith('https://'))
                            ?.public_url || tunnels[0].public_url;

                    if (!publicUrl) {
                        return reject(
                            new Error('No se encontró ninguna public_url en ngrok')
                        );
                    }

                    resolve(publicUrl);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function main() {
    // 1. Arrancar "vercel dev" en el puerto 3000
    console.log('▶️ Arrancando vercel dev en puerto 3000...');
    const vercelProc = spawn('vercel', ['dev', '--port', '3000'], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });

    vercelProc.on('exit', code => {
        console.log(`⚠️ vercel dev se ha cerrado con código ${code}`);
    });

    // 2. Esperar 3 segundos a que vercel arranque
    await sleep(3000);

    // 3. Arrancar ngrok apuntando al puerto 3000
    console.log('▶️ Arrancando ngrok: ngrok http 3000 --log=stdout ...');
    const ngrokProc = spawn('ngrok', ['http', '3000', '--log=stdout'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
    });

    ngrokProc.stdout.on('data', chunk => {
        process.stdout.write(chunk.toString());
    });

    ngrokProc.stderr.on('data', chunk => {
        process.stderr.write(chunk.toString());
    });

    ngrokProc.on('exit', code => {
        console.log(`⚠️ ngrok se ha cerrado con código ${code}`);
    });

    // 4 + 5. Esperar hasta que la URL pública esté disponible (máx 15 intentos)
    console.log('⏳ Esperando a que ngrok exponga la URL pública...');
    let publicUrl = null;
    const maxAttempts = 15;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            publicUrl = await getNgrokPublicUrl();
            console.log(`✅ URL de ngrok detectada: ${publicUrl}`);
            break;
        } catch (err) {
            console.log(
                `Intento ${attempt}/${maxAttempts}: aún no hay URL de ngrok (${err.message})`
            );
            await sleep(1000);
        }
    }

    if (!publicUrl) {
        console.error('❌ No se pudo obtener la URL pública de ngrok.');
        process.exit(1);
    }

    // Normalizamos para que no termine en "/"
    const baseUrl = publicUrl.replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/webhook`;

    // 6. Actualizar el webhook de Telegram
    console.log('▶️ Actualizando webhook de Telegram...');
    await setTelegramWebhook(webhookUrl, TELEGRAM_TOKEN);

    // 7. Mostrar en consola la URL final
    console.log('✅ Bot arrancado');
    console.log('✅ Webhook actualizado');
    console.log(`🌐 URL: ${webhookUrl}`);
}

main().catch(err => {
    console.error('❌ Error en dev.js:', err);
    process.exit(1);
});

