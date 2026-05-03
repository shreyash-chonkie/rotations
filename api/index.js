import app, { startLevelBuffer } from "../server/index.js";

startLevelBuffer();

export default function handler(request, response) {
  return app(request, response);
}
