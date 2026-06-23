This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Editor Setup (Cursor / VSCode)

이 프로젝트는 Cursor / VSCode 설정이 포함되어 있습니다.

### 들여쓰기 & 포맷팅

`.vscode/settings.json` 파일이 자동으로 적용됩니다. (탭 크기 2, Prettier, 저장 시 자동 포맷)

권장 확장 프로그램 설치: `Cmd+Shift+P` → `Extensions: Show Recommended Extensions`

### 단축키 적용

VSCode/Cursor는 프로젝트 레벨 단축키를 직접 지원하지 않으므로, 아래 스크립트로 적용하세요.

```bash
# Cursor에 적용 (기본값)
bash scripts/apply-keybindings.sh

# VSCode에 적용
bash scripts/apply-keybindings.sh --vscode
```

| 단축키       | 동작                 |
| ------------ | -------------------- |
| `Cmd+D`      | 현재 줄 삭제         |
| `Alt+Left`   | 뒤로 이동            |
| `Alt+Right`  | 앞으로 이동          |
| `Cmd+Left`   | 줄 맨 앞으로 (Home)  |
| `Cmd+I`      | Cursor AI Agent 모드 |
| `Ctrl+Cmd+F` | 찾기/바꾸기          |

> 단축키 레퍼런스: `.vscode/keybindings.json`

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
