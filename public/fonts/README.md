# Noto Sans KR

이 디렉터리의 `NotoSansKR.ttf`는 한글 이모티콘 대사를 서버에서 PNG·GIF·WebP에 합성하는 데 사용합니다. 시스템에 한글 폰트가 설치되어 있지 않아도 같은 번들 파일을 사용합니다. 폰트는 2026-09-30에 아래 Google Fonts 저장소에서 내려받았으며 글리프나 폰트 메타데이터를 수정하지 않았습니다. 원본 파일 이름 `NotoSansKR[wght].ttf`를 배포 경로에서 `NotoSansKR.ttf`로 저장했습니다.

- [Google Fonts의 Noto Sans KR 원본 폴더](https://github.com/google/fonts/tree/main/ofl/notosanskr)
- [원본 가변 폰트 파일](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf)
- [원본 라이선스 파일](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt)
- [프로젝트에 함께 보관한 SIL Open Font License 1.1](OFL.txt)

번들된 라이선스의 저작권 고지는 `Copyright 2014-2021 Adobe`이며 Reserved Font Name은 `Source`입니다. 배포 시 폰트와 `OFL.txt`를 함께 유지하세요. 이 문서는 라이선스 원문을 대신하지 않습니다.

`server/captions.ts`는 이 파일을 명시적으로 지정해 대사를 렌더링합니다. 서버의 임시 디렉터리에 Fontconfig 설정과 캐시를 만들며, 프로젝트의 폰트 파일은 변경하지 않습니다. 대사를 넣은 결과물과 대사 없는 원본은 따로 저장됩니다. 대사 변경은 로컬 합성이며 이미지 생성 API를 호출하지 않습니다.
