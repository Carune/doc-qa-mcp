# doc-qa-mcp

臾몄꽌 QA??MCP ?쒕쾭 ?ы듃?대━???꾨줈?앺듃?낅땲??  
濡쒖뺄 臾몄꽌(`.md`, `.txt`)瑜??몃뜳?깊븯怨? 寃??寃곌낵? 異쒖쿂(citation)瑜?湲곕컲?쇰줈 ?듬??????덉뒿?덈떎.

## 1. ?꾩옱 援ы쁽 踰붿쐞

- MCP ?꾧뎄 ?쒓났: `health_check`, `index_documents`, `list_sources`, `search_chunks`, `ask_with_citations`
- REST API ?쒓났: `/api/index`, `/api/index-text`, `/api/sources`, `/api/search`, `/api/ask`
- ???곕え UI ?쒓났: `GET /`
- 寃??紐⑤뱶
1. `lexical`(湲곕낯): ?ㅼ썙??湲곕컲 寃??2. `semantic`: ?꾨쿋??湲곕컲 寃??- ?듬? 紐⑤뱶
1. `client_llm`(湲곕낯): ?쒕쾭??洹쇨굅/?붿빟留?諛섑솚, 理쒖쥌 ?먯뿰???앹꽦? ?대씪?댁뼵??LLM???대떦
2. `ollama`: ?쒕쾭媛 濡쒖뺄 Ollama 紐⑤뜽濡?理쒖쥌 ?듬?源뚯? ?앹꽦

## 2. 鍮좊Ⅸ ?쒖옉

```bash
npm install
npm run dev
```

湲곕낯 ?묒냽:

- ?곕え UI: `http://localhost:3000/`
- ?ъ뒪泥댄겕: `http://localhost:3000/healthz`
- MCP ?붾뱶?ъ씤?? `http://localhost:3000/mcp`

## 3. ?ㅽ뻾 紐⑤뱶 ?ㅼ젙(.env)

`.env.example`??蹂듭궗?댁꽌 `.env`瑜?留뚮뱺 ???ъ슜?섏꽭??

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000

ENABLE_PGVECTOR=false
DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa

OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

EMBEDDING_PROVIDER=none
ANSWER_MODE=client_llm
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b-instruct
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

VECTOR_DIMENSION=1536
```

### 3-1. 異붿쿇 紐⑤뱶

- ?꾩쟾 臾대즺 濡쒖뺄 ?곕え(寃??+ ?쒕쾭 ?듬? ?앹꽦)
1. `EMBEDDING_PROVIDER=ollama`
2. `ANSWER_MODE=ollama`

- ?⑥닚 MVP(寃?됰쭔)
1. `EMBEDDING_PROVIDER=none`
2. `ANSWER_MODE=client_llm`

## 4. Ollama 湲곕컲 "吏꾩쭨 RAG" ?ㅽ뻾

### 4-1. Ollama 紐⑤뜽 以鍮?
```bash
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
```

### 4-2. .env ?ㅼ젙

```env
EMBEDDING_PROVIDER=ollama
ANSWER_MODE=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b-instruct
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

### 4-3. ?쒕쾭 ?ㅽ뻾

```bash
npm run dev
```

## 5. ?ъ슜 ?쒖꽌(?섎룄???숈옉 ?먮쫫)

1. 臾몄꽌 ?몃뜳??- ?뚯씪 寃쎈줈 ?몃뜳?? `/api/index`
- ?뚯씪 ?낅줈???몃뜳?? `/api/index-text`

2. 寃???뺤씤
- `/api/search` ?먮뒗 `search_chunks`濡?洹쇨굅 泥?겕 ?뺤씤

3. 吏덉쓽 ?묐떟
- `/api/ask` ?먮뒗 `ask_with_citations`
- 諛섑솚媛믪쓽 `answer_generation_mode` ?뺤씤
1. `client_llm`: ?쒕쾭??洹쇨굅 湲곕컲 ?붿빟源뚯?
2. `ollama`: ?쒕쾭媛 理쒖쥌 ?듬?源뚯? ?앹꽦

## 6. ?ㅺ뎅??愿??二쇱쓽?ы빆

- `lexical` 紐⑤뱶?먯꽌??臾몄꽌 ?몄뼱? 吏덈Ц ?몄뼱媛 媛숈븘??寃???뺥솗?꾧? ?믪뒿?덈떎.
- ?ㅺ뎅???? ?ㅽ럹?몄뼱 臾몄꽌 + ?쒓뎅??吏덈Ц)瑜??먰븯硫?`EMBEDDING_PROVIDER=ollama` ?먮뒗 OpenAI ?꾨쿋??湲곕컲??`semantic` 紐⑤뱶瑜??ъ슜?섏꽭??

## 7. ?뚯뒪???됯?

```bash
npm run test
npm run eval
```

- `test`: ?⑥쐞/?듯빀 ?뚯뒪??- `eval`: ?섑뵆 吏덈Ц??湲곗? 媛꾨떒 吏??異쒕젰(`top_citation_hit_rate`, `keyword_hit_rate`, `avg_latency_ms`)

## 8. ChatGPT 而ㅻ꽖???곌껐

1. ?쒕쾭 ?ㅽ뻾(`MCP_TRANSPORT=http`)
2. ?몃? 怨듦컻 URL ?뺣낫(Cloudflare Tunnel ?먮뒗 ngrok)
3. ChatGPT ??而ㅻ꽖?곗뿉 `https://<public-url>/mcp` ?깅줉

二쇱쓽:

- ChatGPT Pro 援щ룆怨?OpenAI API 怨쇨툑? 蹂꾧컻?낅땲??
- `ANSWER_MODE=client_llm`?대㈃ ChatGPT媛 理쒖쥌 臾몄옣??留뚮뱾怨? `ANSWER_MODE=ollama`?대㈃ ?쒕쾭媛 理쒖쥌 臾몄옣??留뚮벊?덈떎.

## 9. 포트폴리오 자료

- 포트폴리오 요약(아키텍처/지표): `docs/portfolio/overview.md`
- 3분 데모 스크립트: `docs/portfolio/demo-script.md`
- 보안 및 운영 노트: `docs/portfolio/security-ops.md`

