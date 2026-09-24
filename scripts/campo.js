// Imprime um campo de um arquivo JSON (para ler texto que a ferramenta Read cortou, linha > 2000 caracteres).
// Uso: node scripts/campo.js work/lotes/lote-NN/itens/<sys_id>.json variaveis.22.question_text
const fs = require('fs');
const [, , arquivo, caminho = ''] = process.argv;
if (!/^work[\\/]lotes[\\/]/.test(arquivo || '')) { console.error('só lê arquivos em work/lotes/'); process.exit(2); }
const v = caminho.split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), JSON.parse(fs.readFileSync(arquivo, 'utf8')));
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
