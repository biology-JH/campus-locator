CREATE TABLE IF NOT EXISTS `bookings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `room_id` int NOT NULL,
  `teacher_id` varchar(64) NOT NULL,
  `teacher_name` varchar(160) NOT NULL,
  `schedule_week` enum('A','B') NOT NULL,
  `weekday` enum('Monday','Tuesday','Wednesday','Thursday','Friday') NOT NULL,
  `class_period` enum('mentor','lesson1','lesson2','lesson3','lesson4','lesson5','lesson6','lesson7') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `bookings_id` PRIMARY KEY (`id`),
  CONSTRAINT `booking_room_slot_unique` UNIQUE (`room_id`,`schedule_week`,`weekday`,`class_period`),
  INDEX `booking_slot_lookup_idx` (`schedule_week`,`weekday`,`class_period`),
  CONSTRAINT `bookings_room_id_classrooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `classrooms`(`id`) ON DELETE cascade ON UPDATE no action
);
