# VERIFY — 온라인 아마도 월드 v2 (메뉴 교체)  · 2026-11-13

## 변경
- menu.json: 스펙의 new_menu로 전체 교체 (출처: 2026-09-10 네이버 플레이스 메뉴판)
- scenarios.json: owner 객체 5개 대사만 교체 (diff상 enter/order/closing 3줄만 실제 변경, service/care는 스펙값이 기존과 동일)
- main.js / index.html: 기능 변경 없음. 화면에 하드코딩된 "2023-04 메뉴판 기준" 문구 3곳(main.js:704, index.html:69·119)만 "2026-09 메뉴판 기준"으로 수정 (스펙 외 최소 보정 — 새 메뉴와 모순되는 라벨이라 수정)
- 제거된 id(dakkkochi, kimchijeon, starcheongha, makju)는 main.js·scenarios.json 어디에서도 참조되지 않음 → 리맵 불필요
- 백업: ../menu.v1.bak.json, ../scenarios.v1.bak.json

## 통과
- node --check main.js
- menu.json / scenarios.json json.load 정상 (item+service id 35개)
- python3 -m http.server로 서빙, index.html·main.js·menu.json·scenarios.json·style.css 모두 HTTP 200
- 시나리오 recommend id 및 event.service id 전부 menu.json에 존재 (누락 0). 시나리오 4의 bingsu(황도빙수)는 side 항목으로 유지됨

## 미확인
- 브라우저 실제 렌더링·3D 동작·메뉴판 UI 표시 (헤드리스/브라우저 실행 안 함)
- Supabase 실시간 연결, PeerJS 화상
- 메뉴·가격·영업시간·전화의 실제 정확성 (스펙 JSON을 그대로 옮겼을 뿐, 이번 세션에서 네이버 재확인 안 함)
- 영업시간은 네이버/카카오 표기가 달라 원본에서도 불확실
- 긴 메뉴명(예: "아마도 빨간 돼지 불고기 뽀끔밥") 줄바꿈/레이아웃 영향
- 배포 안 함 (GitHub·Vercel 제외)
