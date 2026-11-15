export async function extractBrowserMaterial(blob: Blob, name: string): Promise<string> {
  if (/\.(txt|md|csv|json)$/i.test(name) || blob.type.startsWith('text/')) {
    if (blob.size > 2 * 1024 * 1024) throw new Error('텍스트 자료는 2MB까지 읽을 수 있어요. 원본은 보관했어요.');
    return (await blob.text()).slice(0, 30000);
  }
  if (/\.pdf$/i.test(name) || blob.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
    try {
      const pdf = await task.promise; let text = '';
      for (let page = 1; page <= Math.min(pdf.numPages, 20) && text.length < 30000; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        text += '\n[페이지 ' + page + ']\n' + content.items.map(item => 'str' in item ? item.str : '').join(' ');
      }
      if (!text.replace(/\[페이지 \d+\]/g, '').trim()) throw new Error('이 PDF에서 텍스트를 읽지 못했어요. 스캔/OCR 자료는 아직 지원하지 않아요.');
      return text.slice(0, 30000);
    } finally { await task.destroy(); }
  }
  throw new Error('PDF·TXT·MD·CSV·JSON 자료를 읽을 수 있어요. 이 파일은 원본만 보관했어요.');
}
