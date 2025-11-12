# 🧠 recordweb

Este projeto demonstra como **gravar interações reais em uma página web**, incluindo mutações dinâmicas do DOM, e **detectar automaticamente quando o reCAPTCHA invisível é resolvido** (por exemplo, quando o `g-recaptcha-response` é atualizado de forma oculta).

Os scripts são baseados em **Playwright + rrweb**, e permitem capturar um `JSON` completo da sessão e depois **analisar** o conteúdo para encontrar o token do reCAPTCHA e o contexto DOM.

---

## 📦 Requisitos

- Node.js 18+
- npm ou yarn
- Google Chrome ou Chromium (instalado localmente)

---

## ⚙️ Instalação

```bash
git clone https://github.com/seuusuario/rrweb-recaptcha-capture.git
cd rrweb-recaptcha-capture

npm init -y
npm install playwright rrweb fs
```

> 💡 Se aparecer o aviso:
> ```
> [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file is not specified
> ```
> Basta adicionar `"type": "module"` no seu `package.json`:
>
> ```json
> {
>   "type": "module"
> }
> ```

---

## 🚀 1. Gravando o site

O script `record_ap_getran.js` abre a página desejada e **grava todas as mutações DOM, cliques, inputs e atualizações do reCAPTCHA invisível**.

### 🧩 Passos

1. Edite o arquivo e troque a URL da página desejada:
   ```js
   const url = "https://seusite.com/formulario";
   ```

2. Execute:
   ```bash
   node record_ap_getran.js
   ```

3. O terminal exibirá logs como:
   ```
   Injetando rrweb e abrindo a página...
   [rrweb-mirror] g-recaptcha-response updated length=396
   Capturando eventos... pressione ENTER para parar
   ```

4. Após terminar de preencher o formulário e o reCAPTCHA ser resolvido automaticamente (hidden), pressione **ENTER** no terminal.

5. Um arquivo será gerado:
   ```
   rrweb_capture_<timestamp>.json
   ```

Esse arquivo contém todos os eventos DOM e mutações ocorridas durante a sessão.

---

## 🔍 2. Analisando o arquivo

O script `find_rrweg.js` analisa o JSON gerado pelo passo anterior e procura pelo conteúdo relacionado ao **reCAPTCHA**.

Ele mostra o **id**, **name** e **text/value** de todos os nós DOM relevantes.

### 🧩 Como executar:

```bash
node find_rrweg.js rrweb_capture_1731352643513.json
```

### 📋 Saída de exemplo:

```
🕵️ Analisando arquivo: rrweb_capture_1731352643513.json

📌 Token detectado:
  ID: 292
  Tipo: input
  Name: g-recaptcha-response
  Valor (cortado): 0cAFcWeA7ypHXFMvCb1mpyJz7HNb5oXZqJUhJa...

🏷️ Contexto DOM:
  - id="g-recaptcha-response"
  - name="g-recaptcha-response"
  - parent form[name="form-login"]
```

Se houver múltiplos tokens capturados, todos serão listados com seus respectivos nós DOM e timestamps.

---

## 🧠 Estrutura dos arquivos

```
.
├── record_ap_getran.js   # Grava a interação do site
├── find_rrweg.js         # Analisa o JSON gerado
├── package.json
└── rrweb_capture_*.json  # Arquivos de captura
```

---

## ⚡ Dicas avançadas

- Se o site tiver CSP rígido (ex: bloqueia `addScriptTag`), você pode abrir em modo “--disable-web-security” no Chrome manualmente, mas normalmente não é necessário.
- O script automaticamente cria um **mirror hidden** (`__rr_recaptcha_mirror`) para garantir que o rrweb capture alterações feitas em elementos invisíveis.
- Cada token capturado é logado no console com:
  ```
  [rrweb-mirror] g-recaptcha-response updated length=396
  ```

---

## 🧩 Licença

MIT © 2025 — Desenvolvido para experimentação e análise de automação com reCAPTCHA e rrweb.

---

## 💬 Contato

Se quiser discutir ou contribuir com melhorias:
- Abra uma issue ou PR neste repositório.
- Ou entre em contato pelo GitHub.
