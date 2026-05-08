import json

try:
    with open('danang_courts.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for court in data:
        if 'Trang Hoàng' in court.get('title', ''):
            print(f"Name: {court.get('title')}")
            images = court.get('images', [])
            print(f"Total Images in JSON: {len(images)}")
            
            # Check for images in reviews
            reviews = court.get('user_reviews', [])
            review_images_count = 0
            for r in reviews:
                r_imgs = r.get('images', [])
                if r_imgs:
                    review_images_count += len(r_imgs)
            print(f"Total Review Images: {review_images_count}")
            break
except Exception as e:
    print(f"Error: {e}")
