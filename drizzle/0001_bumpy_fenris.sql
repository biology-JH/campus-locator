CREATE TABLE `classrooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomNumber` varchar(64) NOT NULL,
	`sourcePage` int NOT NULL,
	`displayOrder` int NOT NULL,
	CONSTRAINT `classrooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `classrooms_roomNumber_unique` UNIQUE(`roomNumber`)
);
--> statement-breakpoint
CREATE TABLE `timetable_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomNumber` varchar(64) NOT NULL,
	`week` enum('A','B') NOT NULL,
	`day` enum('Monday','Tuesday','Wednesday','Thursday','Friday') NOT NULL,
	`period` enum('mentor','lesson1','lesson2','lesson3','lesson4','lesson5','lesson6','lesson7') NOT NULL,
	`occupant` text,
	`sourcePage` int NOT NULL,
	CONSTRAINT `timetable_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `timetable_room_slot_unique` UNIQUE(`roomNumber`,`week`,`day`,`period`)
);
--> statement-breakpoint
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_roomNumber_classrooms_roomNumber_fk` FOREIGN KEY (`roomNumber`) REFERENCES `classrooms`(`roomNumber`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `classrooms_display_order_idx` ON `classrooms` (`displayOrder`);--> statement-breakpoint
CREATE INDEX `timetable_availability_idx` ON `timetable_entries` (`week`,`day`,`period`);