'use strict';

function buildStyles(panelId) {
  return `
    #${panelId}{position:fixed;z-index:2147483647;inset:2vh 1.5vw;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.62);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Noto Sans JP",sans-serif;display:flex;flex-direction:column;overflow:hidden;text-align:left}
    #${panelId} *{box-sizing:border-box}
    #${panelId} header{padding:12px 14px;background:#0b1220;border-bottom:1px solid #374151;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #${panelId} h2{font-size:17px;line-height:1.25;margin:0 4px 0 0;white-space:nowrap;color:#f9fafb}
    #${panelId} .grow{flex:1}
    #${panelId} button,#${panelId} a.sld-action,#${panelId} select{font:inherit;color:#f9fafb;background:#1f2937;border:1px solid #4b5563;border-radius:8px;padding:7px 9px;text-decoration:none;cursor:pointer;line-height:1.2}
    #${panelId} button,#${panelId} a.sld-action{display:inline-flex;align-items:center;justify-content:center;gap:5px}
    #${panelId} select{padding-right:26px}
    #${panelId} button:hover,#${panelId} a.sld-action:hover{background:#374151}
    #${panelId} button:disabled,#${panelId} select:disabled{opacity:.45;cursor:not-allowed}
    #${panelId} .sld-primary{background:#2563eb!important;border-color:#3b82f6!important}
    #${panelId} .sld-danger{background:#7f1d1d!important;border-color:#991b1b!important}
    #${panelId} .sld-language-wrap{display:inline-flex;gap:6px;align-items:center;white-space:nowrap;margin-left:auto}
    #${panelId} .sld-statusbar,#${panelId} .sld-queuebar{padding:9px 14px;border-bottom:1px solid #374151;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#111827}
    #${panelId} .sld-queuebar{background:#0f172a}
    #${panelId} progress{width:min(420px,42vw);height:14px}
    #${panelId} .sld-filters{display:flex;gap:5px;flex-wrap:wrap}
    #${panelId} .sld-filter.sld-active{background:#4f46e5}
    #${panelId} .sld-tablewrap{overflow:auto;flex:1;min-height:0}
    #${panelId} table{width:100%;border-collapse:separate;border-spacing:0;min-width:1300px;color:#f9fafb;background:transparent}
    #${panelId} th{position:sticky;top:0;background:#0b1220;z-index:2;text-align:left;padding:9px;border-bottom:1px solid #4b5563;white-space:nowrap;color:#f9fafb;font-weight:700}
    #${panelId} td{padding:8px 9px;border-bottom:1px solid #263244;vertical-align:top;background:transparent;color:#f9fafb}
    #${panelId} tbody tr:hover td{background:#172033}
    #${panelId} .sld-muted{color:#9ca3af;font-size:12px}
    #${panelId} .sld-title{font-weight:650}
    #${panelId} .sld-pill{display:inline-block;border-radius:999px;padding:2px 7px;font-size:11px;white-space:nowrap;margin:0 4px 4px 0}
    #${panelId} .sld-pill.ok{background:#064e3b;color:#a7f3d0}
    #${panelId} .sld-pill.warn{background:#78350f;color:#fde68a}
    #${panelId} .sld-pill.bad{background:#7f1d1d;color:#fecaca}
    #${panelId} .sld-pill.info{background:#1e3a8a;color:#bfdbfe}
    #${panelId} .sld-pill.partial{background:#164e63;color:#a5f3fc}
    #${panelId} .sld-matchbtn{display:block!important;margin:0 0 5px;width:100%;text-align:left;justify-content:flex-start!important;max-width:370px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${panelId} .sld-matchbtn.sld-requested{border-color:#047857;background:#064e3b}
    #${panelId} .sld-fallback{background:#164e63!important;border-color:#0e7490!important;margin:0 4px 5px 0}
    #${panelId} .sld-oldlink{color:#93c5fd}
    #${panelId} footer{padding:8px 14px;border-top:1px solid #374151;color:#9ca3af;background:#0b1220}
    #${panelId} .sld-error{color:#fca5a5;max-width:300px;word-break:break-word;margin-top:5px}
    #${panelId} .sld-rate-blocked{color:#fbbf24;font-weight:650}
    #${panelId} .sld-rate-ok{color:#a7f3d0}
    #${panelId} label.sld-inline{display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
    #${panelId} .sld-queue-message{min-width:210px;max-width:620px}
    #${panelId} .sld-last-requested{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${panelId} .sld-history-overlay{position:absolute;inset:0;background:rgba(2,6,23,.86);z-index:20;display:flex;align-items:center;justify-content:center;padding:24px}
    #${panelId} .sld-history-overlay[hidden]{display:none}
    #${panelId} .sld-history-dialog{width:min(1100px,96%);max-height:88%;background:#111827;border:1px solid #4b5563;border-radius:14px;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.7);overflow:hidden}
    #${panelId} .sld-history-header{padding:13px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#0b1220;border-bottom:1px solid #374151}
    #${panelId} .sld-history-header h3{margin:0;font-size:17px;color:#f9fafb}
    #${panelId} .sld-history-body{overflow:auto;min-height:180px;max-height:65vh}
    #${panelId} .sld-history-body table{min-width:920px}
    #${panelId} .sld-history-note{padding:10px 14px;color:#cbd5e1;border-top:1px solid #374151;background:#0f172a}
    #${panelId} .sld-history-empty{padding:32px 18px;text-align:center;color:#9ca3af}
    #${panelId} .sld-history-actions{display:flex;gap:5px;flex-wrap:wrap}
    #${panelId} .sld-id{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cbd5e1;word-break:break-all}
    @media (max-width:900px){
      #${panelId}{inset:1vh 1vw}
      #${panelId} header{align-items:flex-start}
      #${panelId} .sld-language-wrap{margin-left:0}
      #${panelId} progress{width:100%}
    }
  `;
}

module.exports = { buildStyles };
