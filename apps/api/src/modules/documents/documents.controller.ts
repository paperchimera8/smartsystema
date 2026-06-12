import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { NativeAuthGuard } from "../auth/native-auth.guard";
import { OcrService } from "./ocr.service";

const MAX_FILE_BYTES = 16 * 1024 * 1024;

const OCR_UI_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>СмартСистема — OCR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f11;color:#e8e8ed;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:48px 16px}
  h1{font-size:22px;font-weight:600;letter-spacing:-.3px;margin-bottom:6px}
  .sub{color:#6e6e7a;font-size:14px;margin-bottom:40px}
  .drop{border:2px dashed #2a2a35;border-radius:16px;padding:48px 32px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;max-width:520px;width:100%}
  .drop:hover,.drop.over{border-color:#5b5bf6;background:#16161f}
  .drop svg{opacity:.35;margin-bottom:16px}
  .drop p{color:#6e6e7a;font-size:14px;line-height:1.6}
  .drop strong{color:#b5b5c3}
  input[type=file]{display:none}
  .btn{display:inline-flex;align-items:center;gap:8px;margin-top:20px;padding:10px 22px;background:#5b5bf6;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;transition:opacity .15s}
  .btn:hover{opacity:.85}
  .btn:disabled{opacity:.4;cursor:default}
  .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .result{margin-top:32px;max-width:520px;width:100%}
  .card{background:#16161f;border:1px solid #1e1e2a;border-radius:14px;padding:20px 24px;margin-bottom:12px}
  .card-title{font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#5b5bf6;margin-bottom:14px}
  .meta-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-bottom:1px solid #1e1e2a}
  .meta-row:last-child{border-bottom:none}
  .meta-key{font-size:13px;color:#6e6e7a;flex-shrink:0}
  .meta-val{font-size:13px;color:#e8e8ed;text-align:right;word-break:break-word}
  .field-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #1e1e2a;font-size:13px}
  .field-row:last-child{border-bottom:none}
  .field-name{color:#b5b5c3;font-weight:500}
  .field-val{color:#e8e8ed}
  .badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap}
  .hi{background:#1a2e1a;color:#4ade80}
  .mid{background:#2a2510;color:#facc15}
  .lo{background:#2a1010;color:#f87171}
  .conf-bar{height:4px;border-radius:2px;background:#1e1e2a;margin-top:8px;overflow:hidden}
  .conf-fill{height:100%;border-radius:2px;background:#5b5bf6;transition:width .6s ease}
  .err{background:#1e0a0a;border:1px solid #4a1010;border-radius:14px;padding:16px 20px;color:#f87171;font-size:14px}
  .filename{font-size:12px;color:#5b5bf6;margin-top:8px;word-break:break-all}
</style>
</head>
<body>
<h1>СмартСистема OCR</h1>
<p class="sub">Загрузите PDF или изображение документа</p>

<div class="drop" id="drop">
  <svg width="40" height="40" fill="none" viewBox="0 0 24 24"><path stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 16V8m0 0-3 3m3-3 3 3M6 20h12a2 2 0 0 0 2-2V8.828a2 2 0 0 0-.586-1.414l-4.828-4.828A2 2 0 0 0 13.172 2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/></svg>
  <p><strong>Перетащите файл сюда</strong><br>или нажмите для выбора</p>
  <p style="margin-top:8px;font-size:12px">PDF, JPEG, PNG, WebP · до 16 МБ</p>
  <input type="file" id="file" accept=".pdf,image/*">
  <button class="btn" id="btn" onclick="document.getElementById('file').click()" type="button">Выбрать файл</button>
  <div class="filename" id="fname"></div>
</div>

<div class="result" id="result"></div>

<script>
const drop=document.getElementById('drop');
const fileInput=document.getElementById('file');
const btn=document.getElementById('btn');
const fname=document.getElementById('fname');
const result=document.getElementById('result');

drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0];if(f)process(f)});
fileInput.addEventListener('change',()=>{if(fileInput.files[0])process(fileInput.files[0])});

function conf(v){return v>=0.85?'hi':v>=0.6?'mid':'lo'}
function pct(v){return Math.round(v*100)+'%'}

async function process(file){
  fname.textContent=file.name;
  btn.disabled=true;
  btn.innerHTML='<div class="spinner"></div> Распознаём...';
  result.innerHTML='';

  const fd=new FormData();
  fd.append('file',file);

  try{
    const r=await fetch('/api/documents/upload',{method:'POST',body:fd});
    const data=await r.json();

    if(!r.ok){
      result.innerHTML='<div class="err">Ошибка: '+(data.message||r.statusText)+'</div>';
      return;
    }

    const docTypeMap={invoice:'Счёт-фактура',waybill:'Накладная',act:'Акт',contract:'Договор',receipt:'Кассовый чек',upd:'УПД',other:'Документ'};
    const cPct=Math.round(data.overallConfidence*100);

    result.innerHTML=\`
<div class="card">
  <div class="card-title">Документ</div>
  <div class="meta-row"><span class="meta-key">Тип</span><span class="meta-val">\${docTypeMap[data.documentType]||data.documentType}</span></div>
  <div class="meta-row"><span class="meta-key">Модель</span><span class="meta-val">\${data.model}</span></div>
  <div class="meta-row"><span class="meta-key">Токены</span><span class="meta-val">\${data.tokenUsage.inputTokens}↑ \${data.tokenUsage.outputTokens}↓</span></div>
  <div class="meta-row"><span class="meta-key">Уверенность</span><span class="meta-val"><span class="badge \${conf(data.overallConfidence)}">\${cPct}%</span></span></div>
  <div class="conf-bar"><div class="conf-fill" style="width:\${cPct}%"></div></div>
</div>
<div class="card">
  <div class="card-title">Поля (\${data.fields.length})</div>
  \${data.fields.map(f=>{
    const v=typeof f.value==='string'&&f.value.startsWith('[{')?
      JSON.parse(f.value).map(i=>i.name||(i.Наименование)||JSON.stringify(i)).join(', ')
      :f.value;
    return \`<div class="field-row">
      <span class="field-name">\${f.name}</span>
      <span class="field-val">\${v}</span>
      <span class="badge \${conf(f.confidence)}">\${pct(f.confidence)}</span>
    </div>\`;
  }).join('')}
</div>\`;
  }catch(e){
    result.innerHTML='<div class="err">Сетевая ошибка: '+e.message+'</div>';
  }finally{
    btn.disabled=false;
    btn.innerHTML='Выбрать файл';
  }
}
</script>
</body>
</html>`;

@ApiTags("documents")
@Controller("documents")
export class DocumentsController {
  constructor(private readonly ocr: OcrService) {}

  @Get("ocr-ui")
  @ApiExcludeEndpoint()
  @Header("Content-Type", "text/html; charset=utf-8")
  ui(): string {
    return OCR_UI_HTML;
  }

  @Post("upload")
  @UseGuards(NativeAuthGuard)
  @ApiOperation({ summary: "Upload a PDF or image and extract fields via OCR" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } }
    }
  })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException(
        'No file received. Send multipart/form-data with field name "file".'
      );
    }
    return this.ocr.extractFromFile(file);
  }
}
