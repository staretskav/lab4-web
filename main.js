import http from 'node:http';
import fs from 'node:fs';
import { Command } from 'commander';

const program = new Command();

program
  .helpOption('--help', 'Показати довідку')
  .requiredOption('-i, --input <path>', 'Шлях до файлу даних')
  .requiredOption('-h, --host <address>', 'Адреса сервера')
  .requiredOption('-p, --port <number>', 'Порт сервера')
  .option('-o, --output <path>', 'Файл для останньої відповіді');

program.parse(process.argv);

const options = program.opts();
const port = Number(options.port);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Помилка: некоректний номер порту');
  process.exit(1);
}

// Перевіряємо існування вхідного файлу через колбек.
fs.access(options.input, fs.constants.F_OK, (accessError) => {
  if (accessError) {
    console.error('Cannot find input file');
    process.exitCode = 1;
    return;
  }

  startServer();
});

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // Надсилаємо JSON-відповідь.
    // Якщо вказано --output, зберігаємо останню відповідь.
    function sendResponse(status, data) {
      const body = JSON.stringify(data);

      function finish(finalStatus, finalBody) {
        res.writeHead(finalStatus, {
          'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(finalBody);
      }

      if (!options.output) {
        finish(status, body);
        return;
      }

      fs.writeFile(options.output, body, 'utf8', (writeError) => {
        if (writeError) {
          finish(500, JSON.stringify({
            error: 'Помилка запису у файл'
          }));
          return;
        }

        finish(status, body);
      });
    }

    if (req.method !== 'GET' || url.pathname !== '/') {
      sendResponse(404, {
        error: 'Маршрут не знайдено'
      });
      return;
    }

    const humidityEnabled =
      url.searchParams.get('humidity') === 'true';

    const minRainfallText =
      url.searchParams.get('min_rainfall');

    let minRainfall = null;

    if (minRainfallText !== null) {
      if (
        minRainfallText.trim() === '' ||
        !Number.isFinite(Number(minRainfallText))
      ) {
        sendResponse(400, {
          error: 'Параметр min_rainfall має бути числом'
        });
        return;
      }

      minRainfall = Number(minRainfallText);
    }

    // Читаємо дані заново під час кожного запиту.
    fs.readFile(options.input, 'utf8', (readError, content) => {
      if (readError) {
        sendResponse(500, {
          error: 'Помилка читання файлу даних'
        });
        return;
      }

      let weather;

      try {
        weather = JSON.parse(content);
      } catch {
        sendResponse(500, {
          error: 'Некоректний формат JSON'
        });
        return;
      }

      if (!Array.isArray(weather)) {
        sendResponse(500, {
          error: 'Очікувався JSON-масив'
        });
        return;
      }

      const result = [];

      for (const item of weather) {
        if (item === null || typeof item !== 'object') {
          continue;
        }

        // Пропускаємо записи без коректних числових даних.
        function validNumber(value) {
          return value !== null &&
            value !== undefined &&
            String(value).trim() !== '' &&
            Number.isFinite(Number(value));
        }

        if (
          !validNumber(item.Rainfall) ||
          !validNumber(item.Pressure3pm)
        ) {
          continue;
        }

        const rainfall = Number(item.Rainfall);
        const pressure3pm = Number(item.Pressure3pm);

        if (minRainfall !== null && rainfall <= minRainfall) {
          continue;
        }

        const record = {
          rainfall,
          pressure3pm
        };

        if (humidityEnabled) {
          record.humidity = validNumber(item.Humidity3pm)
            ? Number(item.Humidity3pm)
            : null;
        }

        result.push(record);
      }

      sendResponse(200, result);
    });
  });

  server.on('error', (error) => {
    console.error('Помилка сервера:', error.message);
    process.exitCode = 1;
  });

  server.listen(port, options.host, () => {
    console.log(
      `Server running at http://${options.host}:${port}`
    );
  });
}
