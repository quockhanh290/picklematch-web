import json

try:
    with open('danang_courts.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for court in data:
        if 'Trang Hoàng' in court.get('title', ''):
            print(f"Name: {court.get('title')}")
            print(f"Review Count: {court.get('review_count')}")
            reviews = court.get('user_reviews', [])
            print(f"User Reviews Length: {len(reviews)}")
            print("Names of reviewers:")
            for r in reviews:
                print(f"- {r.get('user_name') or r.get('name')}")
            break
except Exception as e:
    print(f"Error: {e}")
