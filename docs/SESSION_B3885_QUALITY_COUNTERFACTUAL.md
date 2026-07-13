# Phan tich counterfactual session b3885ff2

Ngay phan tich: 2026-07-13

Session: `b3885ff2-8871-4e82-a53d-ce861939d614`

## Pham vi

- 33 nguoi choi, 6 san, 8 vong logic, 48 tran da hoan tat.
- Giu nguyen nhom nguoi da duoc chon trong tung vong, chi thu chia lai doi/san.
- O vong 6, thay hai suat trung lap bang nguoi dang nghi co uu tien cao nhat de mo phong invariant moi.
- Moi phuong an deu dung `scoreMatch` va cap nhat repeat/rest bang engine that.
- Chi chap nhan phuong an khong tang partner repeat, opponent repeat hoac gender-preference penalty trong tung vong.

Script:

```powershell
npx tsx scripts/diagnostics/evaluate-session-quality-counterfactual.ts tmp/session-b3885ff2-8871-4e82-a53d-ce861939d614-end-state
```

## Ket qua tong

| Chi so | Thuc te | Lookahead co rang buoc | Quality debt co rang buoc |
| --- | ---: | ---: | ---: |
| Team gap trung binh | 0.423 | 0.321 | 0.320 |
| Team gap toi da | 2.06 | 0.87 | 0.87 |
| Tran team gap > 0.5 | 12 | 9 | 8 |
| Tran team gap > 1 | 5 | 0 | 0 |
| Intra gap trung binh | 0.781 | 0.670 | 0.648 |
| Intra gap toi da | 2.43 | 1.96 | 1.76 |
| Tran intra gap > 1 | 10 | 5 | 5 |
| Tran intra gap > 2 | 3 | 0 | 0 |
| Partner repeat | 2 | 0 | 1 |
| Opponent repeat | 28 | 23 | 25 |
| Player quality debt toi da | 6.75 | 1.27 | 1.23 |
| Player quality debt p95 | 4.08 | 1.16 | 1.07 |

Thoi gian benchmark offline: khoang 51 giay. Khong phu hop de dua nguyen thuat toan nay vao Edge request.

## Root cause va kha nang cai thien

1. Co du dia cai thien cach chia doi neu engine biet ca board 24 nguoi. Phan lon tran xau khong phai la gioi han toan hoc cua tap nguoi ca vong.
2. Live flow chi tao tung san khi san do trong. Tai thoi diem tao, nhieu nguoi cua cung vong van dang ban o san khac, nen pool thuc te nho hon nhieu so voi 24 nguoi cua ca vong.
3. Tran team gap 2.06 chi co dung bon nguoi hop le tai thoi diem suggest. Khong co cach chia hoac scoring khac de tao mot tran khac tu pool do.
4. Trong 30 giay sau khi san nay trong, hai san khac da ket thuc. Co che tight-pool wait toi da 30 giay hien tai la giai phap dung cho case nay.
5. Tran team gap 1.39 co sau nguoi hop le, nhung khong san nao giai phong nguoi trong gan hai phut. Cho lau hon 30 giay co the cai thien chat luong nhung lam giam nhip van hanh qua nhieu.

## Quyet dinh production

- Giu fix per-lane logical-round eligibility tai commit `659b0ef`.
- Giu bounded tight-pool wait 30 giay tai `ed04f8b` va `80c51f3`.
- Chua dua local-search 51 giay vao Edge.
- Chua them quality-debt vao scoring production vi dump hien tai khong luu toan bo alternatives de chung minh no khong lam doi tier fairness/repeat trong tung request.
- Session moi can duoc smoke test va pull dump de do lai sau Edge version 146.

## Huong tiep theo an toan

1. Luu top alternatives va cac metric da duoc tinh san cho cac request co outlier; khong dump toan bo search tree.
2. Chay counterfactual tren nhieu session, khong chi mot session.
3. Neu quality-debt thang o nhieu session, chi dung lam tie-breaker trong cung quality/fairness tier.
4. Neu van con nhieu outlier unavoidable, can product decision ve thoi gian cho toi da hoac lap ke hoach ca vong truoc.
