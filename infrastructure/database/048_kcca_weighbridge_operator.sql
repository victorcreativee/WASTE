INSERT INTO roles(name,description)
VALUES('weighbridge_operator','KCCA weighbridge worker responsible for official vehicle weighing')
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description;
